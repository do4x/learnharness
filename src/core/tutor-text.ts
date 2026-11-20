/** Protocol-shaped tool invocations are not learner-facing prose. Never execute
 * them. Keep feedback before the leaked invocation; quarantine its whole tail
 * (including answer keys). This also protects display of older saved messages. */
export function tutorText(text: string): string {
	const marker = /\[assistant\s+to=|\btext\(await\s+tools\.|\b(?:await\s+)?tools\.(?:probe|quiz|explain|recall)\s*\(/g;
	const match = marker.exec(text);
	return match ? text.slice(0, match.index).trimEnd() : text;
}
