import assert from "node:assert/strict";
import test from "node:test";
import { formatPr, formatPrWidgets, parseChecks, parsePr, parsePrUrl, PR_WIDGET_IDS } from "../extensions/pr.js";

test("parses PR URLs without accepting lookalike hosts or unsafe numbers", () => {
  assert.deepEqual(parsePrUrl("see https://github.com/railwayapp/mono/pull/41208?tab=files"), { repo: "railwayapp/mono", number: 41208 });
  assert.equal(parsePrUrl("https://github.com.evil.test/owner/repo/pull/1"), undefined);
  assert.equal(parsePrUrl("https://github.com/owner/repo/pull/99999999999999999999"), undefined);
  assert.equal(parsePrUrl("https://github.com/owner/repo/pull/12/evil"), undefined);
});

test("counts CheckRuns and StatusContexts including failures and unknown states", () => {
  assert.deepEqual(parseChecks([
    { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "skip", conclusion: "SKIPPED" },
    { name: "lint", status: "IN_PROGRESS" },
    { context: "deploy", state: "PENDING" },
    { context: "CI", state: "ERROR" },
    { name: "test", conclusion: "TIMED_OUT" },
    { name: "unknown", status: "COMPLETED" },
    {},
  ]), { passed: 2, running: 3, failed: 2 });
});

test("formats a compact, colored status and hyperlinks only the PR number", () => {
  const pr = parsePr({ number: 41208, url: "https://github.com/railwayapp/mono/pull/41208", state: "OPEN", statusCheckRollup: [
    { name: "a", conclusion: "SUCCESS" }, { name: "b", status: "IN_PROGRESS" }, { name: "c", conclusion: "FAILURE" },
  ] });
  assert.ok(pr);
  const status = formatPr(pr, (color, text) => `<${color}>${text}</${color}>`);
  assert.equal(status, "<success></success> \x1b]8;;https://github.com/railwayapp/mono/pull/41208\x1b\\#41208\x1b]8;;\x1b\\ · <success> 1</success>  <warning> 1</warning>  <error> 1</error>");
  assert.ok(!status.includes("checks passed"));
  assert.ok(!status.includes(" PR "));
  assert.ok(!status.endsWith(pr.url));
  assert.match(formatPr({ ...pr, checks: { passed: 10, running: 0, failed: 0 } }, (_, text) => text), /·  10   0   0$/);
  assert.equal(formatPr({ ...pr, checks: { passed: 0, running: 0, failed: 0 } }, (_, text) => text).includes("·"), false);
  assert.match(formatPr({ ...pr, state: "CLOSED" }, (c, t) => `<${c}>${t}</${c}>`), /^<error>/);
  assert.match(formatPr({ ...pr, state: "MERGED" }, (c, t) => `<${c}>${t}</${c}>`), /^<warning>/);
  assert.equal(parsePr({ number: 2, url: pr.url, state: "OPEN" }), undefined);
});

test("composable pi-footer event values allow per-widget icons, colors and ordering", () => {
  const pr = parsePr({
    number: 12, url: "https://github.com/owner/repo/pull/12", title: "Add tests\x1b]8;;evil\x07", state: "MERGED",
    statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }],
  });
  assert.ok(pr);
  const widgets = formatPrWidgets(pr, (_, text) => text);
  assert.deepEqual(Object.keys(widgets), [...PR_WIDGET_IDS]);
  assert.equal(widgets["gh-pr-number"], "\x1b]8;;https://github.com/owner/repo/pull/12\x1b\\#12\x1b]8;;\x1b\\");
  assert.equal(widgets["gh-pr-state"], "merged");
  assert.equal(widgets["gh-pr-repo"], "owner/repo");
  assert.equal(widgets["gh-pr-title"], "Add tests ]8;;evil ");
  assert.deepEqual([widgets["gh-pr-passed"], widgets["gh-pr-running"], widgets["gh-pr-failed"]], ["1", "0", "0"]);
  assert.equal(widgets["gh-pr-checks"], " 1   0   0");
  assert.equal(widgets["gh-pr-state-icon"], "");
});
