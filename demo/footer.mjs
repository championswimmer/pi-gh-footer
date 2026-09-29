// Render the real formatter for VHS, rather than a separately hand-drawn mockup.
import { formatPr, parsePr } from "../extensions/pr.ts";

const colors = { success: 32, warning: 33, error: 31, dim: 90, muted: 90 };
const paint = (color, text) => `\x1b[${colors[color]}m${text}\x1b[0m`;
const samples = [
  { number: 41208, checks: { passed: 10, running: 0, failed: 0 } },
  { number: 41209, checks: { passed: 3, running: 1, failed: 0 } },
  { number: 41210, checks: { passed: 0, running: 2, failed: 1 } },
];

process.stdout.write("\x1b[2J\x1b[H"); // Keep the shell command out of VHS captures.
console.log();
for (const { number, checks } of samples) {
  const pr = parsePr({ number, url: `https://github.com/railwayapp/mono/pull/${number}`, state: "OPEN", statusCheckRollup: [
    ...Array.from({ length: checks.passed }, (_, i) => ({ name: `passed-${i}`, conclusion: "SUCCESS" })),
    ...Array.from({ length: checks.running }, (_, i) => ({ name: `running-${i}`, status: "IN_PROGRESS" })),
    ...Array.from({ length: checks.failed }, (_, i) => ({ name: `failed-${i}`, conclusion: "FAILURE" })),
  ] });
  const branch = paint("dim", " orch-ha-stage-2  ·   +0 ±0 ?0  ·  ");
  console.log(`  ${branch}${formatPr(pr, paint)}\n`);
}
// Keep the prompt off the screenshot while VHS captures the completed output.
await new Promise((resolve) => setTimeout(resolve, 8000));
