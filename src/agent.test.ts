import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_CONFIG, lessonOptions, toolPathAllowed, TraceProjector, validateConfig, validatePrompt, verifyFile } from "./agent.js";

test("validate inputs and force the one-turn preset", () => {
  assert.equal(validatePrompt(" hi "), "hi"); assert.throws(() => validatePrompt(" "));
  assert.equal(validateConfig({ scenario: "limit", maxTurns: 10 }).maxTurns, 1);
  for (const value of [{ maxTurns: 0 }, { maxBudgetUsd: NaN }, { partial: "yes" }, { effort: "invented" }]) assert.throws(() => validateConfig(value));
});
test("read-only scenario removes editing and command tools", () => {
  const options = lessonOptions(validateConfig({ scenario: "inspect" }), () => {});
  assert.deepEqual(options.tools, ["Read", "Glob"]); assert.ok(options.disallowedTools!.includes("Bash"));
  assert.equal(lessonOptions(DEFAULT_CONFIG, () => {}).includePartialMessages, true);
});
test("only the exact demo command and target edits pass the hook guard", () => {
  assert.ok(toolPathAllowed("Bash", { command: "npm test" }));
  assert.equal(toolPathAllowed("Bash", { command: "npm test && echo extra" }), false);
  assert.ok(toolPathAllowed("Read", { file_path: "auth.test.ts" }));
  assert.equal(toolPathAllowed("Edit", { file_path: "auth.test.ts" }), false);
  assert.equal(toolPathAllowed("Read", { file_path: resolve(".env") }), false);
});
test("count assistant response IDs, not streamed blocks, and correlate tool results", () => {
  const p = new TraceProjector();
  p.consume({ type: "assistant", message: { id: "response-a", content: [{ type: "text", text: "Inspecting" }] } } as SDKMessage);
  p.consume({ type: "assistant", message: { id: "response-a", content: [{ type: "tool_use", id: "tool-a", name: "Read", input: { file_path: "auth.ts" } }] } } as SDKMessage);
  const rows = p.consume({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-a", content: "file" }] } } as SDKMessage);
  assert.equal(p.responses.size, 1); assert.equal(p.counts.assistant, 2); assert.equal(p.requests.size, 1);
  assert.ok(rows.some((row) => row.type === "message" && row.toolId === "tool-a" && row.responseGroup === 1));
});
test("partial events do not create another response or tool request", () => {
  const p = new TraceProjector();
  p.consume({ type: "stream_event", event: { type: "content_block_delta" } } as SDKMessage);
  assert.equal(p.responses.size, 0); assert.equal(p.requests.size, 0); assert.equal(p.counts.stream_event, 1);
});
test("limit results retain subtype, cost, usage and stop reason", () => {
  const rows = new TraceProjector().consume({ type: "result", subtype: "error_max_turns", is_error: true, errors: [], session_id: "test", total_cost_usd: 0.01, num_turns: 1, stop_reason: "tool_use", usage: { input_tokens: 20, output_tokens: 5 } } as unknown as SDKMessage);
  const result = rows.find((row) => row.type === "result");
  assert.ok(result?.type === "result"); assert.equal(result.status, "error_max_turns"); assert.equal(result.inputTokens, 20); assert.equal(result.stopReason, "tool_use");
});
test("independent auth checks detect three failures and accept a corrected control", async () => {
  assert.equal((await verifyFile(resolve("fixtures/auth.ts"))).passed, 1);
  assert.equal((await verifyFile(resolve("fixtures/auth.fixed.ts"))).passed, 4);
});
