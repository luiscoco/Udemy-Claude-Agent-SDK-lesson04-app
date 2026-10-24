import { DEFAULT_PROMPT, runAgent, validateConfig } from "./agent.js";

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith("your_")) {
  console.error("Set ANTHROPIC_API_KEY in this shell, or use npm run sample:env."); process.exit(1);
}
const scenario = process.argv[2] || "repair";
const config = validateConfig({ scenario, effort: process.argv[3] || "low", partial: true });
try {
  await runAgent(DEFAULT_PROMPT, (event) => {
    if (event.type === "message" && event.sdkType !== "stream_event") console.log(`${event.sequence} ${event.sdkType} ${event.subtype} · ${event.detail}`);
    if (event.type === "tool") console.log(`Hook: ${event.name} ${event.phase} ${event.elapsedMs}ms`);
    if (event.type === "result") console.log(`RESULT ${JSON.stringify(event)}`);
    if (event.type === "workspace") console.log(`${event.stage}: ${event.checks.passed}/${event.checks.total}; changed=${event.changed}`);
    if (event.type === "notice") console.log(event.text);
  }, new AbortController(), config);
} catch { console.error("The SDK stream failed before a final result. Check setup and model access."); process.exitCode = 1; }
