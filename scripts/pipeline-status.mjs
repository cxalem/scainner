#!/usr/bin/env node
// Pipeline dashboard: shows every workflow stream, its current stage, its
// artifacts, and its branch state, straight from the repo. No deps.
//
//   node scripts/pipeline-status.mjs           one snapshot
//   node scripts/pipeline-status.mjs --watch   live view, refreshes every 5s
//
// Data sources, all plain files (the whole pipeline is file-based on
// purpose so it can be inspected without any tooling):
//   docs/workflows/<stream>/status.json   written by the orchestrator
//   docs/workflows/<stream>/*.md          stage artifacts + decision logs
//   git branches ws/<stream>              builder output
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const WF = path.join(ROOT, "docs", "workflows");

const STAGES = ["research", "plan", "build", "review", "codex-review", "done"];

function git(cmd) {
  try {
    return execSync(`git -C "${ROOT}" ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function ago(mtime) {
  const s = Math.round((Date.now() - mtime) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function render() {
  const streams = fs
    .readdirSync(WF, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !["roles", "patterns"].includes(d.name))
    .map((d) => d.name);

  const lines = [];
  lines.push(`SCAINNER PIPELINE  ·  ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
  lines.push("=".repeat(72));

  if (streams.length === 0) lines.push("(no streams yet)");

  for (const stream of streams) {
    const dir = path.join(WF, stream);
    let status = { stage: "?", state: "?", notes: [] };
    const statusPath = path.join(dir, "status.json");
    if (fs.existsSync(statusPath)) {
      try {
        status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
      } catch {
        status.notes = ["status.json unreadable"];
      }
    }

    // Stage progress bar from which artifacts exist
    const have = (f) => fs.existsSync(path.join(dir, f));
    const marks = {
      research: have("research.md"),
      plan: have("plan.md"),
      build: !!git(`rev-parse --verify -q ws/${stream}`),
      review: have("review-report.md"),
      "codex-review": have("codex-review.md"),
      done: status.state === "merged",
    };
    const bar = STAGES.map((s) => (marks[s] ? `[x] ${s}` : `[ ] ${s}`)).join("  ");

    lines.push("");
    lines.push(`■ ${stream}   stage: ${status.stage ?? "?"}   state: ${status.state ?? "?"}`);
    lines.push(`  ${bar}`);

    const branch = git(`rev-parse --verify -q ws/${stream}`) ? `ws/${stream}` : null;
    if (branch) {
      const last = git(`log -1 --format="%h %s (%cr)" ${branch}`);
      const n = git(`rev-list --count main..${branch}`);
      lines.push(`  branch ${branch}: ${n} commit(s) ahead of main · last: ${last}`);
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { f, mtime: st.mtimeMs, lines: fs.readFileSync(path.join(dir, f), "utf8").split("\n").length };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const { f, mtime, lines: n } of files) {
      lines.push(`    ${f.padEnd(28)} ${String(n).padStart(4)} lines   ${ago(mtime)}`);
    }
    for (const note of status.notes ?? []) lines.push(`  note: ${note}`);
    lines.push(`  read one by one: docs/workflows/${stream}/`);
  }

  lines.push("");
  lines.push("-".repeat(72));
  lines.push("Deep dive: every stage has a decisions-*.md log explaining why each");
  lines.push("choice was made. Open any file above, or run with --watch to follow live.");
  return lines.join("\n");
}

if (process.argv.includes("--watch")) {
  const tick = () => {
    console.clear();
    console.log(render());
  };
  tick();
  setInterval(tick, 5000);
} else {
  console.log(render());
}
