export interface PrRef {
  repo: string;
  number: number;
}

export interface PrInfo extends PrRef {
  url: string;
  title?: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  checks: { passed: number; running: number; failed: number };
}

// Match only real GitHub pull URLs, never an arbitrary hostname containing github.com.
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?![\w/])/i;

export function parsePrUrl(text: string): PrRef | undefined {
  const match = PR_URL.exec(text);
  if (!match) return undefined;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { repo: match[1], number } : undefined;
}

export function parseChecks(value: unknown): PrInfo["checks"] {
  const checks = { passed: 0, running: 0, failed: 0 };
  if (!Array.isArray(value)) return checks;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const check = item as Record<string, unknown>;
    const conclusion = String(check.conclusion ?? "").toUpperCase();
    const status = String(check.status ?? check.state ?? "").toUpperCase();
    // GitHub's rollup includes both CheckRuns and StatusContexts.
    if (!check.name && !check.context && !conclusion && !status) continue;
    if (["SUCCESS", "NEUTRAL", "SKIPPED", "EXPECTED"].includes(conclusion) || status === "SUCCESS" || status === "EXPECTED") {
      checks.passed++;
    } else if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR"].includes(conclusion) || ["FAILURE", "ERROR"].includes(status)) {
      checks.failed++;
    } else {
      // Unknown/queued/in-progress checks must never look green.
      checks.running++;
    }
  }
  return checks;
}

export function parsePr(value: unknown): PrInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== "string" || typeof raw.number !== "number" || !Number.isSafeInteger(raw.number)) return undefined;
  const ref = parsePrUrl(raw.url);
  if (!ref || ref.number !== raw.number || !["OPEN", "CLOSED", "MERGED"].includes(String(raw.state))) return undefined;
  // Titles come from GitHub/user input: never let control characters into a terminal widget.
  const title = typeof raw.title === "string" ? [...raw.title.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")].slice(0, 200).join("") : undefined;
  return { ...ref, url: `https://github.com/${ref.repo}/pull/${ref.number}`, title, state: raw.state as PrInfo["state"], checks: parseChecks(raw.statusCheckRollup) };
}

export type Color = "success" | "warning" | "error" | "dim" | "muted";
export type Paint = (color: Color, text: string) => string;

function stateColor(pr: PrInfo): Color {
  return pr.state === "OPEN" ? "success" : pr.state === "MERGED" ? "warning" : "error";
}

function linkedNumber(pr: PrInfo): string {
  // OSC 8 wraps only the PR number; no bare URL consumes footer width.
  return `\x1b]8;;${pr.url}\x1b\\#${pr.number}\x1b]8;;\x1b\\`;
}

function formatChecks(pr: PrInfo, paint: Paint): string | undefined {
  const { passed, running, failed } = pr.checks;
  if (!passed && !running && !failed) return undefined;
  // A full-size Nerd Font circle and its adjacent digit can overlap in terminals.
  // Use a small typographic dot with breathing room; the PR icon stays Nerd Font.
  return `${paint(passed ? "success" : "dim", `• ${passed}`)}  ${paint(running ? "warning" : "dim", `• ${running}`)}  ${paint(failed ? "error" : "dim", `• ${failed}`)}`;
}

export function formatPr(pr: PrInfo, paint: Paint): string {
  const result = `${paint(stateColor(pr), "\uf407")} ${linkedNumber(pr)}`;
  const checks = formatChecks(pr, paint);
  return checks ? `${result} · ${checks}` : result;
}

// pi-footer event widgets let users compose a footer of their own: icon, text,
// colors, ordering and visibility are all controlled in pi-footer's widget UI.
// Raw counts are deliberately unstyled so each widget's fg/icon can be chosen there.
export function formatPrWidgets(pr: PrInfo, paint: Paint): Record<string, string | null> {
  return {
    "gh-pr": formatPr(pr, paint),
    "gh-pr-number": linkedNumber(pr),
    "gh-pr-state-icon": paint(stateColor(pr), "\uf407"),
    "gh-pr-state": pr.state.toLowerCase(),
    "gh-pr-checks": formatChecks(pr, paint) ?? null,
    "gh-pr-passed": String(pr.checks.passed),
    "gh-pr-running": String(pr.checks.running),
    "gh-pr-failed": String(pr.checks.failed),
    "gh-pr-repo": pr.repo,
    "gh-pr-title": pr.title || null,
  };
}

export const PR_WIDGET_IDS = [
  "gh-pr", "gh-pr-number", "gh-pr-state-icon", "gh-pr-state", "gh-pr-checks",
  "gh-pr-passed", "gh-pr-running", "gh-pr-failed", "gh-pr-repo", "gh-pr-title",
] as const;
