const $ = (id) => document.getElementById(id);
const input = (id) => $(id);
let running = false;
let options;
let defaultPrompt = "";
const records = [];
function appendTrace(data) {
    const row = document.createElement("li");
    row.className = data.type === "message" && data.sdkType === "stream_event" ? "partial" : "";
    const title = document.createElement("strong"), detail = document.createElement("span");
    title.textContent = data.type === "message" ? `#${data.sequence} · ${data.sdkType}${data.subtype ? " / " + data.subtype : ""}${data.responseGroup ? " · response " + data.responseGroup : ""}` : `Hook · ${data.name} · ${data.phase}${data.phase === "end" ? " · " + data.elapsedMs + " ms" : ""}`;
    detail.textContent = data.detail + (data.toolId || data.id ? " · " + (data.toolId || data.id) : "");
    row.append(title, detail);
    $("events").append(row);
    $("events").scrollTop = $("events").scrollHeight;
}
function workspace(data) {
    $(data.stage).textContent = data.source;
    Prism.highlightElement($(data.stage));
    $(data.stage + "-checks").textContent = `${data.checks.passed}/${data.checks.total} independent checks passed`;
    if (data.stage === "after") {
        $("verdict").textContent = data.checks.passed === data.checks.total && data.changed ? "Verified repair" : options.scenario === "inspect" && !data.changed ? "Read-only inspection: file unchanged" : "Stopped or not repaired";
        $("checks").replaceChildren();
        for (const item of data.checks.cases) {
            const row = document.createElement("li");
            row.textContent = `${item.passed ? "PASS" : "FAIL"} · ${item.label}`;
            $("checks").append(row);
        }
    }
}
function consume(data) {
    records.push(data);
    if (data.type === "config")
        options = data.options;
    if (data.type === "workspace")
        workspace(data);
    if (data.type === "answer")
        $("answer").textContent += data.text + "\n\n";
    if (data.type === "message") {
        appendTrace(data);
        $("messages").textContent = String(data.sequence);
        $("responses").textContent = String(data.responses);
        $("requests").textContent = String(data.requests);
        for (const type of ["system", "assistant", "user", "stream_event", "result"])
            $("count-" + type).textContent = String(data.counts[type] || 0);
    }
    if (data.type === "tool")
        appendTrace(data);
    if (data.type === "result") {
        $("status").textContent = data.status;
        $("turns").textContent = String(data.turns);
        $("cost").textContent = "$" + data.costUsd.toFixed(4);
        $("session").textContent = data.sessionId;
        $("stop").textContent = data.stopReason || "null";
        $("usage").textContent = `${data.inputTokens} input · ${data.outputTokens} output`;
        $("result-text").textContent = data.text || "No success text. Inspect the final subtype.";
    }
    if (data.type === "error") {
        $("status").textContent = "transport_error";
        $("result-text").textContent = data.text;
    }
    if (data.type === "notice")
        $("notice").textContent = data.text;
}
$("scenario").addEventListener("change", () => { const mode = input("scenario").value; input("max-turns").value = mode === "limit" ? "1" : mode === "inspect" ? "6" : "10"; input("prompt").value = mode === "inspect" ? "Read auth.ts and auth.test.ts. Explain the three failures without changing files." : defaultPrompt; input("prompt").readOnly = mode === "inspect"; });
input("show-partial").addEventListener("change", () => $("events").classList.toggle("show-partial", input("show-partial").checked));
$("download").addEventListener("click", () => {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }));
    link.href = url;
    link.download = "lesson04-observed-events.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (running)
        return;
    running = true;
    input("run").disabled = true;
    records.length = 0;
    $("events").replaceChildren();
    for (const id of ["answer", "result-text", "notice", "session", "usage"])
        $(id).textContent = "";
    for (const id of ["messages", "responses", "requests", "turns", "count-system", "count-assistant", "count-user", "count-stream_event", "count-result"])
        $(id).textContent = "0";
    $("status").textContent = "running";
    $("after").textContent = "Waiting for the actual resulting file.";
    $("verdict").textContent = "Running";
    $("checks").replaceChildren();
    options = { scenario: input("scenario").value, maxTurns: Number(input("max-turns").value), maxBudgetUsd: Number(input("budget").value), effort: input("effort").value, partial: input("partial").checked, project: input("project").checked };
    try {
        const response = await fetch("/api/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: input("prompt").value, options }) });
        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let end;
            while ((end = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                if (line.trim())
                    consume(JSON.parse(line));
            }
            if (done) {
                if (buffer.trim())
                    consume(JSON.parse(buffer));
                break;
            }
        }
        if (!records.some((item) => item.type === "result"))
            throw new Error("The stream ended without a final SDK result.");
    }
    catch (error) {
        $("notice").textContent = error instanceof Error ? error.message : "The run failed.";
        if (!records.some((item) => item.type === "result"))
            $("status").textContent = "transport_error";
    }
    finally {
        running = false;
        input("run").disabled = false;
    }
});
fetch("/api/config").then((r) => r.json()).then((config) => {
    options = config.defaults;
    defaultPrompt = config.defaultPrompt;
    input("prompt").value = config.defaultPrompt;
    $("model").textContent = config.model;
    workspace({ stage: "before", ...config.workspace });
    $("configuration").textContent = config.ready ? "Key configured on the server" : "Set your API key in .env or the launching shell.";
    input("run").disabled = !config.ready;
}).catch(() => { $("configuration").textContent = "Cannot reach the local server."; });
export {};
