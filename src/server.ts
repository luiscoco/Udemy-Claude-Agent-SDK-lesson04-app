import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { DEFAULT_PROMPT, MODEL, runAgent, baselineState, DEFAULT_CONFIG, validateConfig, validatePrompt } from "./agent.js";

const port = Number(process.env.PORT || 3104);
const root = new URL("../public/", import.meta.url);
const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"], "/index.html": ["index.html", "text/html"],
  "/learn.html": ["learn.html", "text/html"], "/run.html": ["run.html", "text/html"],
  "/architecture.html": ["architecture.html", "text/html"], "/walkthrough.html": ["walkthrough.html", "text/html"],
  "/style.css": ["style.css", "text/css"], "/client.js": ["client.js", "text/javascript"],
  "/prism-python.min.js": ["prism-python.min.js", "text/javascript"],
  "/navigation.js": ["navigation.js", "text/javascript"], "/prism.js": ["prism.js", "text/javascript"],
  "/code-highlighting.js": ["code-highlighting.js", "text/javascript"], "/code-highlighting.css": ["code-highlighting.css", "text/css"],
  "/astronaut.png": ["astronaut.png", "image/png"], "/architecture.svg": ["architecture.svg", "image/svg+xml"],
};
let busy = false;
const ready = () => Boolean(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith("your_"));
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  try {
    if (req.method === "GET" && files[url.pathname]) {
      const [file, type] = files[url.pathname];
      const data = await readFile(new URL(file, root));
      res.writeHead(200, { "Content-Type": type + (type.startsWith("text/") ? "; charset=utf-8" : "") });
      res.end(data); return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ application: "claude-agent-sdk-lesson04" })); return;
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ready: ready(), model: MODEL, defaultPrompt: DEFAULT_PROMPT, workspace: await baselineState(), defaults: DEFAULT_CONFIG })); return;
    }
    if (req.method === "POST" && url.pathname === "/api/query") {
      if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}` && req.headers.origin !== `http://localhost:${port}`) {
        res.writeHead(403); res.end("Use this application's own page."); return;
      }
      if (busy) { res.writeHead(409); res.end("One query is already running. Wait for it to finish."); return; }
      if (!ready()) { res.writeHead(503); res.end("Configure ANTHROPIC_API_KEY in .env, then restart. See How to run."); return; }
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") { res.writeHead(415); res.end("Send JSON."); return; }
      let body = "";
      req.setEncoding("utf8");
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 12000) { res.writeHead(413); res.end("Input too large."); return; } }
      const input = JSON.parse(body);
      const prompt = validatePrompt(input.prompt);
      const config = validateConfig(input.options);
      if (busy) { res.writeHead(409); res.end("One query is already running. Wait for it to finish."); return; }
      busy = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      res.on("close", () => { if (!res.writableEnded) controller.abort(); });
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + "\n"); };
      try { await runAgent(prompt, emit, controller, config); }
      catch { emit({ type: "error", text: controller.signal.aborted ? "The run was cancelled or timed out. Try a shorter prompt." : "The SDK could not finish. Check your API key, model access and the setup troubleshooting section." }); }
      finally { clearTimeout(timer); busy = false; if (!res.destroyed) res.end(); }
      return;
    }
    res.writeHead(404); res.end("Not found.");
  } catch (error) {
    if (!res.headersSent) { res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); res.end(error instanceof SyntaxError ? "Invalid JSON." : error instanceof Error ? error.message : "Invalid request."); }
    else res.end();
  }
});
server.on("error", async (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    let sameApp = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      sameApp = response.ok && (await response.json()).application === "claude-agent-sdk-lesson04";
    } catch { /* Another service may occupy the port. */ }
    if (sameApp) {
      console.log(`Agent SDK Lesson 04 is already running. Open http://127.0.0.1:${port}`);
      console.log("To restart after editing .env or source, press Ctrl+C in its original terminal, then run npm start again.");
      process.exitCode = 0;
    } else {
      console.error(`Port ${port} is already in use by another process. Stop that process, or set a different PORT in .env and run npm start again.`);
      process.exitCode = 1;
    }
    return;
  }
  console.error(`Could not start the local server: ${error.code || error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Open http://127.0.0.1:${port} · Agent SDK Lesson 04 · query()`));
