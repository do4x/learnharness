import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { test } from "node:test";
import { CodexClient, getCodexBinary } from "../src/agent/codex/client.ts";

async function withDirectory(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(path.join(tmpdir(), "lh-codex-discovery-"));
	try { await run(directory); }
	finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
async function executable(file: string) {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, "fixture native executable; never run");
	await chmod(file, 0o755);
}

test("Codex discovery preserves a direct Windows executable", async () => {
	await withDirectory(async (directory) => {
		const file = path.join(directory, "codex.exe"); await executable(file);
		assert.equal(getCodexBinary([directory], "win32", "x64"), file);
	});
});
for (const arch of ["x64", "arm64"]) {
	test(`Codex discovers the npm native ${arch} package without executing codex.cmd`, async () => {
		await withDirectory(async (directory) => {
			await writeFile(path.join(directory, "codex.cmd"), "@echo DO NOT EXECUTE");
			const root = path.join(directory, "node_modules", "@openai", "codex");
			const native = path.join(root, "node_modules", "@openai", `codex-win32-${arch}`);
			await mkdir(native, { recursive: true });
			await writeFile(path.join(root, "package.json"), '{"name":"@openai/codex"}');
			await writeFile(path.join(native, "package.json"), JSON.stringify({ name: `@openai/codex-win32-${arch}` }));
			const target = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
			const binary = path.join(native, "vendor", target, "bin", "codex.exe"); await executable(binary);
			assert.equal(getCodexBinary([directory], "win32", arch), binary);
		});
	});
}
test("Codex supports the official launcher's bundled vendor fallback", async () => {
	await withDirectory(async (directory) => {
		const binary = path.join(directory, "node_modules", "@openai", "codex", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
		await executable(binary);
		assert.equal(getCodexBinary([directory], "win32", "x64"), binary);
	});
});
test("a shell shim alone never becomes a Codex executable", async () => {
	await withDirectory(async (directory) => {
		await writeFile(path.join(directory, "codex.cmd"), "@echo DO NOT EXECUTE");
		assert.equal(getCodexBinary([directory], "win32", "x64"), null);
	});
});
test("Codex keeps direct POSIX executable discovery", async () => {
	await withDirectory(async (directory) => {
		const binary = path.join(directory, "codex"); await executable(binary);
		assert.equal(getCodexBinary([directory], "linux", "x64"), binary);
	});
});
test("logical Codex closure does not report process exit before Windows releases files", async () => {
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
		exitCode: null, kill: () => true,
	}) as unknown as ChildProcessWithoutNullStreams;
	const client = new CodexClient(child);
	let exited = false;
	void client.exited.then(() => { exited = true; });
	client.close(); await Promise.resolve();
	assert.equal(client.alive, false); assert.equal(exited, false);
	child.emit("close", 0, null); await client.exited;
	assert.equal(exited, true);
});
