import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_PROMPT = "Fix the failing tests in auth.ts. Run npm test, inspect the source, make a minimal repair, and run npm test again.";
export const WORKSPACE = fileURLToPath(new URL("../.runtime/loop-workspace/", import.meta.url));
export const TARGET = resolve(WORKSPACE, "auth.ts");
const fixture = (name: string) => new URL("../fixtures/" + name, import.meta.url);
const execute = promisify(execFile);
export type RunConfig = { scenario: "repair" | "limit" | "inspect"; maxTurns: number; maxBudgetUsd: number; effort: "low" | "high"; partial: boolean; project: boolean };
export const DEFAULT_CONFIG: RunConfig = { scenario: "repair", maxTurns: 10, maxBudgetUsd: 0.50, effort: "low", partial: true, project: false };
export type Checks = { passed: number; total: number; cases: { label: string; passed: boolean; expected: unknown; actual?: unknown; error?: string }[] };
export type LabEvent =
  | { type: "config"; options: RunConfig }
  | { type: "message"; sequence: number; sdkType: string; subtype: string; detail: string; responseGroup?: number; toolId?: string; counts: Record<string, number>; responses: number; requests: number }
  | { type: "tool"; phase: "start" | "end" | "denied"; name: string; id: string; elapsedMs: number; detail: string }
  | { type: "answer"; text: string }
  | { type: "result"; status: string; text: string; sessionId: string; costUsd: number; turns: number; stopReason: string | null; inputTokens: number; outputTokens: number }
  | { type: "workspace"; stage: "before" | "after"; source: string; checks: Checks; changed: boolean }
  | { type: "notice" | "error"; text: string };

export function validatePrompt(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2000) throw new Error("Enter a prompt of 1–2,000 characters.");
  return value.trim();
}
export function validateConfig(value: unknown): RunConfig {
  const v = (value || {}) as Partial<RunConfig>;
  const config = { ...DEFAULT_CONFIG, ...v };
  if (!["repair", "limit", "inspect"].includes(config.scenario) || !["low", "high"].includes(config.effort)) throw new Error("Choose a supported scenario and effort.");
  if (!Number.isInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > 12) throw new Error("maxTurns must be 1–12.");
  if (typeof config.maxBudgetUsd !== "number" || !Number.isFinite(config.maxBudgetUsd) || config.maxBudgetUsd < 0.0001 || config.maxBudgetUsd > 1) throw new Error("Budget must be $0.0001–$1.");
  if (typeof config.partial !== "boolean" || typeof config.project !== "boolean") throw new Error("Use boolean streaming/settings options.");
  if (config.scenario === "limit") config.maxTurns = 1;
  return config;
}
export async function verifyFile(target = TARGET): Promise<Checks> {
  const checker = fileURLToPath(new URL("../scripts/check-auth.mjs", import.meta.url));
  const { stdout } = await execute(process.execPath, ["--experimental-strip-types", checker, target], { timeout: 5000, maxBuffer: 200_000, windowsHide: true });
  return JSON.parse(stdout);
}
export async function baselineState() {
  return { source: await readFile(fixture("auth.ts"), "utf8"), checks: await verifyFile(fileURLToPath(fixture("auth.ts"))) };
}
export async function resetWorkspace() {
  await mkdir(WORKSPACE, { recursive: true });
  for (const name of ["auth.ts", "auth.test.ts", "package.json", "CLAUDE.md"]) await writeFile(resolve(WORKSPACE, name), await readFile(fixture(name)));
}
export function toolPathAllowed(name: string, input: Record<string, unknown>) {
  if (name === "Bash") return input.command === "npm test";
  if (name === "Edit") return typeof input.file_path === "string" && resolve(WORKSPACE, input.file_path).toLowerCase() === TARGET.toLowerCase();
  if (name === "Read") return typeof input.file_path === "string" && ["auth.ts", "auth.test.ts", "package.json", "CLAUDE.md"].some((file) => resolve(WORKSPACE, input.file_path as string).toLowerCase() === resolve(WORKSPACE, file).toLowerCase());
  if (name === "Glob") return !String(input.pattern).includes("..") && !/^[\\/]|:/.test(String(input.pattern)) && resolve(WORKSPACE, String(input.path || ".")).toLowerCase() === resolve(WORKSPACE).toLowerCase();
  return false;
}
const inputSummary = (input: Record<string, unknown>) => typeof input.command === "string" ? input.command.slice(0, 180) : typeof input.file_path === "string" ? basename(input.file_path) : String(input.pattern || "").slice(0, 180);

export function lessonOptions(config: RunConfig, emit: (event: LabEvent) => void, abortController = new AbortController()): Options {
  const started = new Map<string, number>();
  const readOnly = config.scenario === "inspect";
  return {
    model: MODEL, cwd: WORKSPACE,
    tools: readOnly ? ["Read", "Glob"] : ["Read", "Edit", "Glob", "Bash"],
    allowedTools: readOnly ? ["Read", "Glob"] : ["Read", "Edit", "Glob", "Bash(npm test)"],
    disallowedTools: readOnly ? ["Edit", "Write", "Bash", "WebFetch"] : ["Write", "WebFetch"],
    permissionMode: readOnly ? "default" : "acceptEdits",
    maxTurns: config.maxTurns, maxBudgetUsd: config.maxBudgetUsd, effort: config.effort,
    includePartialMessages: config.partial, settingSources: config.project ? ["project"] : [],
    persistSession: false, mcpServers: {}, plugins: [], abortController,
    systemPrompt: readOnly ? "Read auth.ts and auth.test.ts using two Read calls in the same response if possible. Explain the bugs briefly. Never edit files or run commands. Tool concurrency is chosen by the runtime." : "Fix only auth.ts. Only an active administrator may access admin; null users are denied. Keep the API and all tests unchanged. First call Bash with exactly npm test, with no other tool call in that first response. Wait for its result. Then inspect the source and tests, make a minimal Edit, and run exactly npm test again. Do not use shell commands other than npm test. Keep explanations brief. Do not repeat a successful edit.",
    hooks: {
      PreToolUse: [{ hooks: [async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const detail = inputSummary(input.tool_input as Record<string, unknown>);
        if (!toolPathAllowed(input.tool_name, input.tool_input as Record<string, unknown>)) {
          emit({ type: "tool", phase: "denied", name: input.tool_name, id: input.tool_use_id, elapsedMs: 0, detail });
          return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Only demo reads, auth.ts edits and exactly npm test are permitted." } };
        }
        started.set(input.tool_use_id, Date.now());
        emit({ type: "tool", phase: "start", name: input.tool_name, id: input.tool_use_id, elapsedMs: 0, detail });
        return {};
      }] }],
      PostToolUse: [{ hooks: [async (input) => {
        if (input.hook_event_name !== "PostToolUse") return {};
        emit({ type: "tool", phase: "end", name: input.tool_name, id: input.tool_use_id, elapsedMs: Date.now() - (started.get(input.tool_use_id) || Date.now()), detail: inputSummary(input.tool_input as Record<string, unknown>) });
        return {};
      }] }],
    },
  };
}

export class TraceProjector {
  counts: Record<string, number> = {};
  responses = new Map<string, number>();
  requests = new Map<string, { name: string; group: number }>();
  sequence = 0;
  consume(message: SDKMessage): LabEvent[] {
    const events: LabEvent[] = [];
    this.counts[message.type] = (this.counts[message.type] || 0) + 1;
    let detail = "SDK lifecycle message", responseGroup: number | undefined, toolId: string | undefined;
    const subtype = "subtype" in message ? String(message.subtype) : "";
    if (message.type === "system") detail = subtype === "init" ? "Runtime initialized; tools and session metadata are available." : `System: ${subtype}`;
    if (message.type === "assistant") {
      const id = message.message.id;
      if (!this.responses.has(id)) this.responses.set(id, this.responses.size + 1);
      responseGroup = this.responses.get(id)!;
      detail = "Assistant content block";
      for (const block of message.message.content) {
        if (block.type === "text") { events.push({ type: "answer", text: block.text }); detail = "Assistant text (not a completion signal)"; }
        if (block.type === "tool_use") {
          toolId = block.id; this.requests.set(block.id, { name: block.name, group: responseGroup });
          detail = `tool_use: ${block.name} · ${inputSummary(block.input as Record<string, unknown>)}`;
        }
      }
    }
    if (message.type === "user") {
      detail = "User input or tool feedback";
      if (Array.isArray(message.message.content)) {
        for (const block of message.message.content) if (block.type === "tool_result") {
          toolId = block.tool_use_id; responseGroup = this.requests.get(toolId)?.group;
          detail = `tool_result: ${this.requests.get(toolId)?.name || "tool"} · ${block.is_error ? "tool reported an error" : "feedback returned to the model"}`;
        }
      }
    }
    if (message.type === "stream_event") detail = `Partial event: ${message.event.type} (not another turn)`;
    if (message.type === "result") {
      const success = message.subtype === "success" && !message.is_error;
      detail = `Final result: ${message.subtype}`;
      events.push({ type: "result", status: success ? "success" : message.subtype === "success" ? "error" : message.subtype,
        text: message.subtype === "success" ? message.result : message.errors.join("\n"), sessionId: message.session_id, costUsd: message.total_cost_usd, turns: message.num_turns,
        stopReason: message.stop_reason, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
    }
    events.unshift({ type: "message", sequence: ++this.sequence, sdkType: message.type, subtype, detail, responseGroup, toolId, counts: { ...this.counts }, responses: this.responses.size, requests: this.requests.size });
    return events;
  }
}
export async function runAgent(prompt: string, emit: (event: LabEvent) => void, abortController = new AbortController(), config = DEFAULT_CONFIG) {
  config = validateConfig(config);
  await resetWorkspace();
  const before = await readFile(TARGET, "utf8");
  emit({ type: "config", options: config });
  emit({ type: "workspace", stage: "before", source: before, checks: await verifyFile(), changed: false });
  const projector = new TraceProjector(); let gotResult = false;
  const conversation = query({ prompt: config.scenario === "inspect" ? "Read auth.ts and auth.test.ts. Explain the three failures without changing files." : prompt, options: lessonOptions(config, emit, abortController) });
  try {
    for await (const message of conversation) {
      for (const event of projector.consume(message)) { if (event.type === "result") gotResult = true; emit(event); }
    }
    if (!gotResult) throw new Error("No final SDK result was received.");
  } catch (error) {
    if (!gotResult) throw error;
    emit({ type: "notice", text: "The runtime closed after a final result. Its observed subtype is preserved." });
  } finally {
    conversation.close();
    const source = await readFile(TARGET, "utf8");
    emit({ type: "workspace", stage: "after", source, checks: await verifyFile(), changed: source !== before });
  }
}
