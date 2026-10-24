import { pathToFileURL } from "node:url";

const cases = [];
try {
  const { canAccessAdmin } = await import(pathToFileURL(process.argv[2]).href);
  for (const [label, user, expected] of [
    ["Missing user denied", null, false],
    ["Inactive administrator denied", { active: false, role: "admin" }, false],
    ["Active viewer denied", { active: true, role: "viewer" }, false],
    ["Active administrator allowed", { active: true, role: "admin" }, true],
  ]) {
    try { const actual = canAccessAdmin(user); cases.push({ label, expected, actual, passed: actual === expected }); }
    catch (error) { cases.push({ label, expected, error: error.name, passed: false }); }
  }
} catch (error) { cases.push({ label: "Import auth.ts", expected: "valid module", error: error.name, passed: false }); }
console.log(JSON.stringify({ passed: cases.filter((item) => item.passed).length, total: 4, cases }));
