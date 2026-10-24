# Claude Agent SDK · Lesson 04 · How the agent loop works

Based on the supplied Lesson04_How_the_Agent_Loop_Works.pptx. A TypeScript loop explorer with real SDK messages, correlated tool requests/results, normal and limited runs, read-only inspection and independent auth regression checks.

## What you will learn

- Follow the five-stage loop: Prompt → model response → tool execution → feedback → repeat or final result. The SDK owns orchestration; your iterator observes it.
- Separate messages, blocks and turns: Several assistant messages may share one response ID. Partial stream events are not turns. Read the SDK num_turns separately from observed response groups.
- Correlate requests and feedback: assistant tool_use.id links to user tool_result.tool_use_id. The interface shows these identifiers and safe descriptions instead of raw credentials or hidden reasoning.
- Observe real execution and approvals: Read/Edit/Glob/Bash availability is separate from allowedTools pre-approval and disallowedTools. Hooks observe and guard real calls; they do not fabricate a fixed four-turn script.
- Experiment with limits and effort: Compare a normal repair with maxTurns: 1, change the SDK budget, and try supported low/high effort. A stopped run stays a stopped run.
- Handle the actual final outcome: Inspect subtype, stop_reason, num_turns, usage, estimated cost and session ID. Continue iteration to completion and preserve an observed error result if the runtime then closes.

## Configure and run

Use Node.js 24+, npm, and a model-accessible API key. Keep optional dependencies installed; Git Bash may be needed on Windows.

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson04-app.git
cd .\Udemy-Claude-Agent-SDK-lesson04-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

Original workspace: use `cd .\agent-sdk\lesson04-agent-loop` from presentations instead of cloning. Open http://127.0.0.1:3104 and keep the terminal open; Ctrl+C stops it. Restart after configuration changes.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3104
```

If needed on Windows, add `CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe`. The SDK reads its process environment; start and sample:env explicitly load an optional file. A shell key takes precedence. No Python interpreter is required to run this lesson.

Same-shell terminal commands:

```powershell
$env:ANTHROPIC_API_KEY = "your_api_key"
npm run sample -- repair low
npm run sample -- limit low
npm run sample -- inspect high
```

Or use `npm run sample:env -- repair low`, `npm run sample:env -- limit low`, and `npm run sample:env -- inspect high`. A stopped experiment is an expected observable outcome; inspect its result subtype.

## Follow the experiments

1. Repair auth.ts: observe actual npm test feedback, Read/Edit activity, and final SDK/host outcomes. The baseline is 1/4; a verified repair reaches 4/4.
2. Choose maxTurns: 1: run again and handle error_max_turns without overwriting it with a generic transport error.
3. Inspect read-only: correlate Read requests and results, observe response grouping, and confirm unchanged source. Do not assume the runtime always schedules parallel requests.
4. Change partial-message capture, effort or budget. Compare the same task with other controls fixed. Cost and quality are observations, not predetermined values.
5. Download the safe observed-events JSON to inspect message types and IDs.

The SDK’s num_turns, message count, response-ID groups and tool-request count are deliberately separate. A partial delta, hook or content block is not automatically another turn. The slide deck’s four-turn example is illustrative, not replayed as fake evidence.

## How the app was built

### 01. Create a reproducible failing task

Three cases fail: a missing user crashes, an inactive administrator is allowed, and an active viewer is allowed. Only an active administrator should pass. The test file remains unchanged.

Source: [fixtures/auth.ts](fixtures/auth.ts)

```typescript
export type User = { active: boolean; role: string };

export function canAccessAdmin(user: User | null): boolean {
  return user!.active || user!.role === "admin";
}

```

### 02. Configure the scenario and limits

Inputs are validated before starting the runtime. The limit preset forces maxTurns to 1. Effort and partial-message settings are actual SDK options, not a simulated dashboard.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 03. Set availability, approval and settings

The repair scenario enables Read/Edit/Glob/Bash, with only exactly npm test allowed by the host guard. Read-only inspection removes editing and Bash. Project settings are opt-in and the fixture includes a classroom CLAUDE.md.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 04. Group assistant response IDs

Every observed message increments its type count. Assistant message.message.id groups blocks from the same response. This grouped count is labelled separately from the final SDK num_turns.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

### 05. Match tool results to their requests

A tool request records its block ID and response group. A later user tool_result carries tool_use_id, so feedback can be linked without assuming every user message is a human prompt.

Source: [src/agent.ts](src/agent.ts)

```typescript
if (message.type === "user") {
      detail = "User input or tool feedback";
      if (Array.isArray(message.message.content)) {
        for (const block of message.message.content) if (block.type === "tool_result") {
          toolId = block.tool_use_id; responseGroup = this.requests.get(toolId)?.group;
          detail = `tool_result: ${this.requests.get(toolId)?.name || "tool"} · ${block.is_error ? "tool reported an error" : "feedback returned to the model"}`;
        }
      }
    }
```

### 06. Preserve result metadata on every subtype

Only success with is_error false is success. Other subtypes keep their identity while cost, usage, turn count, stop reason and session ID remain available. Stream events update counts without inventing more turns.

Source: [src/agent.ts](src/agent.ts)

```typescript
if (message.type === "stream_event") detail = `Partial event: ${message.event.type} (not another turn)`;
    if (message.type === "result") {
      const success = message.subtype === "success" && !message.is_error;
      detail = `Final result: ${message.subtype}`;
      events.push({ type: "result", status: success ? "success" : message.subtype === "success" ? "error" : message.subtype,
        text: message.subtype === "success" ? message.result : message.errors.join("\n"), sessionId: message.session_id, costUsd: message.total_cost_usd, turns: message.num_turns,
        stopReason: message.stop_reason, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
    }
```

### 07. Iterate to completion, then check the file

The host does not break at the result. If the runtime throws after yielding a result, the observed subtype is preserved. A failure before any result remains an error. Independent host checks examine the actual resulting auth.ts.

Source: [src/agent.ts](src/agent.ts)

```typescript
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
```

## Boundaries and maintenance

Only auth.ts can be edited; test/package files are read-only. The sole permitted command is exactly npm test. Read-only mode removes Bash/Edit from tools. Availability, pre-approval and deny rules are separate. The local path/command guards are not an operating-system sandbox; this is a trusted local teaching app. Fixtures are reset for every run and never patched with a stored model answer. The corrected control fixture is only used by offline tests.

Partial events are counted but hidden in the trace until requested by the display toggle. The app shows safe metadata, not raw credentials or hidden chain-of-thought. Project settings are opt-in; the bundled CLAUDE.md supplies classroom instructions. MCP/custom tools and resume are not implemented. Transcript persistence is off, so capturing a session ID does not promise that resume will work. Budget is an SDK estimate threshold, not an exact billing guarantee.

```powershell
npm test
npm run build:client
python scripts/build-pages.py
```

Python is optional for regenerating the student pages only. Node runs the application and all auth checks. All five pages, UML, large-font styles, mascot, source, fixtures and lockfile are bundled. Duplicate app starts print the existing URL; another service requires stopping it or changing PORT. .env, runtime files, node_modules, videos, audio, PowerPoint files and teaching-material stay local and are excluded from Git.

## References

- [Official agent-loop documentation](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)


## Code at every UML workflow step

Every numbered architecture step includes a syntax-coloured source excerpt, its filename and line range, and an explanation connecting the code to that step. scripts/workflow-snippets.py extracts the excerpts from the shipped source on regeneration. SDK-managed operations show the real configuration or observation boundary, with the distinction explained.
