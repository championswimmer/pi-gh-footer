import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import ghFooter from "../extensions/gh-footer.js";

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("timed out waiting for footer update");
}

test("publishes pi-footer status and event, pins URL, prefers branch PR, clears on switch", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-gh-footer-"));
  const bin = join(root, "bin");
  const repo = join(root, "repo");
  mkdirSync(bin);
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "feature", repo]);
  writeFileSync(join(bin, "gh"), `#!/bin/sh
if [ "$3" = "246" ]; then
  printf '%s\\n' '{"number":246,"url":"https://github.com/owner/repo/pull/246","state":"OPEN","statusCheckRollup":[{"name":"CI","status":"IN_PROGRESS"}]}'
else
  printf '%s\\n' "$GH_BRANCH_PR"
fi
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  const oldGh = process.env.GH_BRANCH_PR;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.GH_BRANCH_PR = "";
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => Promise<any>>();
  const statuses: (string | undefined)[] = [];
  const events: { widgetId: string; value: string | null }[] = [];
  const pi = {
    on(name: string, handler: (event: any, ctx: ExtensionContext) => Promise<any>) { handlers.set(name, handler); },
    events: { emit(name: string, value: { widgetId: string; value: string | null }) {
      assert.equal(name, "pi-footer:update-widget");
      events.push(value);
    } },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: repo,
    ui: {
      theme: { fg(_color: string, text: string) { return text; } },
      setStatus(key: string, value: string | undefined) {
        assert.equal(key, "pr-status");
        statuses.push(value);
      },
    },
  } as ExtensionContext;
  const fire = (name: string, event: object, context = ctx) => {
    const handler = handlers.get(name);
    assert.ok(handler, `handler ${name}`);
    return handler(event, context);
  };
  try {
    ghFooter(pi);
    await fire("session_start", {});
    await until(() => statuses.length > 0);
    assert.equal(statuses.at(-1), undefined);

    const reply = await fire("input", { source: "user", text: "https://github.com/owner/repo/pull/246" });
    assert.deepEqual(reply, { action: "continue" });
    await until(() => !!statuses.at(-1)?.includes("#246"));
    assert.match(statuses.at(-1)!, / 0   1   0/);
    assert.doesNotMatch(statuses.at(-1)!, / PR /);
    assert.deepEqual(events.find((event) => event.widgetId === "gh-pr"), { widgetId: "gh-pr", value: statuses.at(-1)! });
    assert.deepEqual(events.find((event) => event.widgetId === "gh-pr-passed"), { widgetId: "gh-pr-passed", value: "0" });
    assert.deepEqual(events.find((event) => event.widgetId === "gh-pr-running"), { widgetId: "gh-pr-running", value: "1" });
    assert.deepEqual(events.find((event) => event.widgetId === "gh-pr-number")?.value?.includes("#246"), true);

    process.env.GH_BRANCH_PR = '{"number":77,"url":"https://github.com/owner/repo/pull/77","state":"OPEN","statusCheckRollup":[{"name":"CI","conclusion":"SUCCESS"}]}';
    await fire("session_start", {}, ctx);
    await until(() => !!statuses.at(-1)?.includes("#77"));
    await fire("input", { source: "user", text: "https://github.com/owner/repo/pull/246" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.match(statuses.at(-1)!, /#77/);

    const other = { ...ctx, cwd: root } as ExtensionContext;
    await fire("session_start", {}, other);
    assert.ok(events.some((event) => event.widgetId === "gh-pr" && event.value === null));
    assert.ok(events.some((event) => event.widgetId === "gh-pr-number" && event.value === null));
    await fire("session_shutdown", {}, other);
    assert.equal(statuses.at(-1), undefined);
  } finally {
    process.env.PATH = oldPath;
    if (oldGh === undefined) delete process.env.GH_BRANCH_PR;
    else process.env.GH_BRANCH_PR = oldGh;
    rmSync(root, { recursive: true, force: true });
  }
});
