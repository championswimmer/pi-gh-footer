import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatPr, formatPrWidgets, parsePr, parsePrUrl, PR_WIDGET_IDS, type PrInfo, type PrRef } from "./pr.js";

const runFile = promisify(execFile);
const STATUS_KEY = "pr-status";
const EVENT = "pi-footer:update-widget";
const POLL_MS = 30_000;
const FIELDS = "number,url,title,state,statusCheckRollup";

async function run(command: string, args: string[], cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await runFile(command, args, { cwd, timeout: 10_000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    return undefined; // No git repo, gh not installed/authenticated, offline, or PR not found.
  }
}

async function fetchPr(args: string[], cwd: string): Promise<PrInfo | undefined> {
  const json = await run("gh", ["pr", "view", ...args, "--json", FIELDS], cwd);
  if (!json) return undefined;
  try {
    return parsePr(JSON.parse(json));
  } catch {
    return undefined;
  }
}

export default function ghFooter(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let context: ExtensionContext | undefined;
  let pinned: PrRef | undefined;
  let activeBranchPr = false;
  let generation = 0;
  const publishedWidgets = new Map<string, string>();

  function publish(ctx: ExtensionContext, pr?: PrInfo) {
    const paint = (color: "success" | "warning" | "error" | "dim" | "muted", text: string) => ctx.ui.theme.fg(color, text);
    // Keep the legacy pi-footer external-status key for existing footer configurations.
    ctx.ui.setStatus(STATUS_KEY, pr ? formatPr(pr, paint) : undefined);
    // pi-footer's event widget is the composable interface: values can be placed,
    // styled, hidden, and reordered using its normal widget editor.
    const widgets = pr ? formatPrWidgets(pr, paint) : undefined;
    for (const widgetId of PR_WIDGET_IDS) {
      const value = widgets?.[widgetId] ?? null;
      if (publishedWidgets.get(widgetId) === (value ?? undefined)) continue;
      if (value === null) publishedWidgets.delete(widgetId);
      else publishedWidgets.set(widgetId, value);
      pi.events.emit(EVENT, { widgetId, value });
    }
  }

  async function refresh(ctx: ExtensionContext) {
    const current = ++generation;
    const cwd = ctx.cwd;
    const branch = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
    const branchPr = branch ? await fetchPr([], cwd) : undefined;
    if (current !== generation) return;
    activeBranchPr = branchPr?.state === "OPEN";

    let pr = branchPr;
    if (activeBranchPr) {
      pinned = undefined; // The current branch always wins over a referenced URL.
    } else if (pinned) {
      const ref = pinned;
      const byNumber = await fetchPr([String(ref.number), "--repo", ref.repo], cwd);
      if (current !== generation) return;
      // Refuse a mismatched/foreign response rather than displaying a misleading link.
      pr = byNumber?.repo.toLowerCase() === ref.repo.toLowerCase() && byNumber.number === ref.number ? byNumber : undefined;
    }
    if (current === generation) publish(ctx, pr);
  }

  function pin(text: string, ctx: ExtensionContext) {
    const ref = parsePrUrl(text);
    if (!ref || activeBranchPr) return;
    pinned = ref;
    void refresh(ctx);
  }

  pi.on("input", async (event, ctx) => {
    if (event.source !== "extension") pin(event.text, ctx);
    return { action: "continue" };
  });
  pi.on("before_agent_start", async (event, ctx) => {
    pin(event.prompt, ctx);
  });
  pi.on("session_start", async (_event, ctx) => {
    generation++;
    context = ctx;
    pinned = undefined;
    activeBranchPr = false;
    publish(ctx); // session_start also fires on new/resumed/forked sessions.
    void refresh(ctx);
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (context) void refresh(context); }, POLL_MS);
    timer.unref?.();
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    context = undefined;
    publish(ctx);
  });
}
