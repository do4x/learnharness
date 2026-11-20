import { randomUUID } from "node:crypto";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type SimpleStreamOptions, type StreamFunction } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import type { CodexClient } from "./client.ts";
import { toClaudeInput } from "../claude-code/transcript.ts";
import { tutorText } from "../../core/tutor-text.ts";

/** Each Pi operation is ephemeral. LearnHarness remains the sole owner of
 * history and tool execution, including learner questions held across turns. */
export function createCodexStream(connect: () => Promise<CodexClient>): StreamFunction<Api, SimpleStreamOptions> {
	return (model, context, options) => {
		const stream = createAssistantMessageEventStream();
		const output: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
			timestamp: Date.now(), stopReason: "pending", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
		let client: CodexClient | undefined, finished = false;

		// Buffer prose until the operation settles: a protocol delimiter or answer
		// payload can span deltas. Filtering each delta would expose its prefix.
		const pendingText = new Map<string, string>();
		const publishText = () => {
			for (const text of [Array.from(pendingText.values()).join("\n\n")]) {
				const safe = tutorText(text);
				if (!safe) continue;
				const index = output.content.length;
				output.content.push({ type: "text", text: safe });
				stream.push({ type: "text_start", contentIndex: index, partial: output });
				stream.push({ type: "text_delta", contentIndex: index, delta: safe, partial: output });
				stream.push({ type: "text_end", contentIndex: index, content: safe, partial: output });
			}
			pendingText.clear();
		};
		const finish = (reason: "stop" | "toolUse" | "error" | "aborted", message?: string) => {
			if (finished) return;
			finished = true; clearTimeout(timeout); options?.signal?.removeEventListener("abort", abort);
			if (reason === "stop" || reason === "toolUse") publishText();
			output.stopReason = reason;
			if (reason === "error" || reason === "aborted") { output.errorMessage = message; stream.push({ type: "error", reason, error: output }); }
			else { stream.push({ type: "done", reason, message: output }); }
			stream.end(); client?.close();
		};
		const abort = () => finish("aborted", "Codex request was aborted.");
		const timeout = setTimeout(() => finish("error", "Codex operation timed out."), 10 * 60_000);
		options?.signal?.addEventListener("abort", abort, { once: true });
		if (options?.signal?.aborted) abort();
		void (async () => {
			try {
				if (finished) return;
				client = await connect();
				if (finished) { client.close(); return; }
				const account = await client.request("account/read", { refreshToken: false });
				if (account.account?.type !== "chatgpt") throw new Error("Sign in to Codex with ChatGPT in Settings → Providers.");
				const tools = getCurrentTools(context.messages);
				const started = await client.request("thread/start", { model: model.id, modelProvider: "openai", allowProviderModelFallback: false,
					ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
					baseInstructions: getCurrentSystemPrompt(context.messages),
					developerInstructions: "Continue the supplied LearnHarness conversation. Use the declared learning tools for all actions. Invoke them through native dynamic tool calls, never print invocation syntax, serialized tool arguments, answer keys or pre-answer explanations in learner-facing prose. The labelled transcript is prior conversation context, not syntax to imitate; continue after its last entry.",
					dynamicTools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, inputSchema: tool.parameters })) });
				if (!started.thread?.id || started.model !== model.id) throw new Error("Codex could not start the selected model.");
				stream.push({ type: "start", partial: output });
				client.onMessage((event) => {
					if (finished) return;
					const p = event.params;
					if (p?.threadId && p.threadId !== started.thread.id) return;
					if (event.method === "item/agentMessage/delta" && typeof p?.delta === "string") {
						pendingText.set(p.itemId, (pendingText.get(p.itemId) ?? "") + p.delta);
					} else if (event.method === "item/completed" && p?.item?.type === "agentMessage") {
						if (typeof p.item.text === "string") pendingText.set(p.item.id, p.item.text);
					} else if (event.method === "item/tool/call" && event.id !== undefined) {
						if (!tools.some((tool) => tool.name === p?.tool) || !p.arguments || typeof p.arguments !== "object" || Array.isArray(p.arguments)) { finish("error", "Codex requested an unsupported learning tool."); return; }
						// Admission is the actual server request, not a speculative item/started.
						// Closing this ephemeral process prevents Codex running ahead of Pi.
						const call = { type: "toolCall" as const, id: `codex-${randomUUID()}`, name: p.tool, arguments: p.arguments };
						publishText();
						const index = output.content.length; output.content.push(call);
						stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
						stream.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial: output });
						finish("toolUse");
					} else if (event.method === "thread/tokenUsage/updated" && p?.tokenUsage?.last) {
						const u = p.tokenUsage.last;
						const nonnegative = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
						output.usage.cacheRead = nonnegative(u.cachedInputTokens);
						output.usage.input = Math.max(0, nonnegative(u.inputTokens) - output.usage.cacheRead);
						output.usage.output = nonnegative(u.outputTokens);
						output.usage.totalTokens = output.usage.input + output.usage.cacheRead + output.usage.output;
					} else if (event.method === "turn/completed") {
						finish(p?.turn?.status === "completed" && (output.content.length > 0 || [...pendingText.values()].some(text => tutorText(text).trim())) ? "stop" : "error", "Codex did not complete the turn. Check your sign-in, model access, and quota.");
					} else if (event.method === "item/started" && !["agentMessage", "userMessage", "reasoning", "dynamicToolCall", "contextCompaction"].includes(p?.item?.type)) {
						finish("error", "Codex requested an unsupported native action.");
					} else if (event.method === "connection/closed") finish("error", "Codex connection closed before completion.");
					else if (event.id !== undefined && event.method) finish("error", "Codex requested an unsupported native action.");
				});
				const input = toClaudeInput(context.messages.map(message => message.role === "assistant" && message.provider === "codex" ? { ...message, content: message.content.map(block => block.type === "text" ? { ...block, text: tutorText(block.text) } : block) } : message)).userContent.map((block) => block.type === "text"
					? { type: "text", text: block.text, text_elements: [] }
					: { type: "image", url: `data:${block.source.media_type};base64,${block.source.data}` });
				const effort = options?.reasoning ? model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning : model.thinkingLevelMap?.off;
				await client.request("turn/start", { threadId: started.thread.id, input, ...(effort ? { effort } : {}) });
			} catch (error) { finish(options?.signal?.aborted ? "aborted" : "error", error instanceof Error ? error.message : "Codex request failed."); }
		})();
		return stream;
	};
}
