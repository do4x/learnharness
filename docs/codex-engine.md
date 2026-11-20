
## Printed tool-call leakage

Codex prose is buffered for one operation and checked before any text event is
published. A printed assistant/tool invocation quarantines its whole trailing
payload, including answer keys and explanations. Only a native app-server
`item/tool/call` can execute a learning tool. Historical Codex messages use the
same display guard without rewriting saved records. Replay also removes the
printed tail, so later turns do not learn it as a response format.

This changes Codex prose delivery to operation-complete rather than token-by-token.
It targets protocol-shaped leakage; it is not a general detector for answers
written as ordinary prose. The developer instruction separately prohibits
pre-answer spoilers. Tests cover split/incomplete deltas, final text, native call
preservation, every emitted event, saved-message projection and normal prose.
