// In-app AI diagnosis reports.
//
// The backend already builds a full diagnostic briefing (`ai_context`: car
// identity, recent DTC scans with freeze frames, sensor stats) that was
// designed for manual pasting into an AI chat. This module closes the loop:
// it sends that briefing to the Anthropic API and returns a structured
// diagnosis. The fetch call itself lives behind AiService
// (core/services/ai-service.ts, the Effect+Schema+Layer pattern) — this
// file owns the prompts, key storage, and report caching around it.
//
// Key handling: the API key is the USER'S OWN, entered once in the Diagnose
// tab and kept in localStorage — deliberately NOT in the SQLite DB (the DB
// is exported wholesale into AI briefings and demo dumps; a key stored
// there would leak into them) and never bundled into the app. This did not
// change when the fetch moved behind AiService: the key is read here and
// passed in as a plain argument, AiService never touches localStorage.
//
// The direct-from-browser call is Anthropic's documented CORS path (the
// `anthropic-dangerous-direct-browser-access` header, set in AiService).
// "Dangerous" refers to shipping a key inside a public web app — irrelevant
// here: this is a local desktop tool and the key is the user's own, entered
// locally.
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { AiService, DeviceService } from "@scainner/core";
import type { Locale } from "@/i18n";

// Phase 4 (docs/workflows/i18n/plan.md): the report itself, not just the
// UI chrome around it, is what a Spanish-speaking mechanic or owner
// actually needs in Spanish — arguably more than the button labels. Not a
// translated prompt (the SYSTEM_PROMPT/CODE_SYSTEM_PROMPT text below stays
// English, that's an instruction TO Claude, not content shown to the
// user) — a language instruction appended to it, so Claude generates the
// whole report in Spanish directly.
const SPANISH_INSTRUCTION =
  "\n\nWrite your entire response in Spanish (español). Translate the section headings naturally into Spanish too — keep the same markdown structure (##, numbered lists), just written in Spanish throughout.";

function withLanguage(systemPrompt: string, locale: Locale): string {
  return locale === "es" ? systemPrompt + SPANISH_INSTRUCTION : systemPrompt;
}

const KEY_STORAGE = "scainner.anthropic_api_key";
const REPORT_STORAGE = "scainner.last_ai_report";

// These calls are the longest real waits in the app (10-60s) and, being a
// plain `fetch` outside `invoke`, can never get IPC progress events — a
// static "Analyzing…" label reads as frozen well before the response
// arrives. Cycled via useCyclingLabel wherever a report is generated
// (interaction-audit.md rule 3, decisions-plan.md "AI generation is in
// scope for feedback rules"). Module-level constant for the same reason as
// meta.ts's phrase arrays: a stable reference for useCyclingLabel's effect.
export const AI_PHASES = ["Sending briefing…", "Waiting for the model…", "Writing report…"] as const;

// Latest-generation default; small enough latency for an interactive
// "generate report" button, strong enough for real diagnostic reasoning.
const MODEL = "claude-sonnet-5";

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key: string) {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

// `lang` records which language the report was actually generated in, so
// a cached report from before a locale switch never silently shows as if
// it matched the current one — callers check `report.lang === locale`
// before trusting a cached report (see AiReportCard.tsx/DtcDetailModal.tsx).
export type SavedReport = { ts: string; md: string; lang: Locale };

export function getLastReport(): SavedReport | null {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE);
    return raw ? (JSON.parse(raw) as SavedReport) : null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are a veteran automotive diagnostic technician writing a report for the car's owner (technically curious, not a mechanic). You receive a diagnostic briefing exported from Scainner, an OBD2 logger: vehicle identity as read from the ECU, recent DTC scans (stored/pending/permanent codes, MIL state, freeze frames, battery voltage), and sensor statistics over recent weeks.

Write a diagnosis report in markdown with exactly these sections:

## Verdict
One short paragraph: overall state of the car and how urgent anything is.

## Trouble codes
For each distinct DTC in the scans: what the code means, the most likely causes RANKED for this specific car using the freeze frame and sensor stats (not a generic list), and whether the scans suggest it is active, intermittent, or historical. If every scan is clean, say so in one line and skip to the next section.

## What the sensor data says
2-4 observations from the sensor stats that are actually noteworthy (trends, values near limits, anything corroborating or contradicting the codes). Skip trivia.

## Recommended next steps
Numbered, ordered by effort/cost — cheapest checks first. Be concrete (what to check, what reading would confirm/rule out).

Rules: never invent data that is not in the briefing; state uncertainty honestly; metric units; under 500 words total.`;

// Call mechanics live in AiService (core/services/ai-service.ts) - same
// wrap-and-validate shape as DeviceService. This function's own signature
// and thrown-Error behavior are unchanged, so the two call sites below
// needed no edits beyond this function's body.
async function callClaude(system: string, userContent: string): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error("No API key configured.");
  return runPromise(Effect.flatMap(AiService, (ai) => ai.complete({ apiKey: key, model: MODEL, system, userContent })));
}

export async function generateDiagnosisReport(locale: Locale): Promise<SavedReport> {
  const briefing = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(24 * 30)));
  const md = await callClaude(withLanguage(SYSTEM_PROMPT, locale), briefing);
  const report: SavedReport = { ts: new Date().toISOString().slice(0, 16).replace("T", " "), md, lang: locale };
  localStorage.setItem(REPORT_STORAGE, JSON.stringify(report));
  return report;
}

// ---------- per-code deep dives ----------

const CODE_REPORTS_STORAGE = "scainner.ai_code_reports";

const CODE_SYSTEM_PROMPT = `You are a veteran automotive diagnostic technician writing a single-fault deep-dive for the car's owner (technically curious, not a mechanic). You receive a Scainner diagnostic briefing about the whole car plus a FOCUS section naming one specific DTC and every recorded occurrence of it.

Write a markdown report about THAT ONE CODE with exactly these sections:

## What this code is telling you
Plain-language explanation, 2-3 sentences.

## Why it most likely happened on this car
Use the occurrence timeline, freeze frame, and sensor stats from the briefing to RANK the likely root causes for this specific car — not a generic causes list. Call out whether the pattern looks active, intermittent, or historical.

## How to confirm it, step by step
Numbered, cheapest/easiest first. For each step: what to do, and what result confirms or rules out that cause. Reference concrete readings where possible.

## Fix options and rough cost
For the top 1-2 likely causes: the fix, DIY feasibility, and a rough EU parts+labor range. Mark estimates clearly as rough.

## Urgency
Can it be driven? What worsens if ignored? One short paragraph.

Rules: never invent data not present in the input; state uncertainty honestly; metric units; under 450 words.`;

export type CodeReports = Record<string, SavedReport>;

export function getCodeReports(): CodeReports {
  try {
    const raw = localStorage.getItem(CODE_REPORTS_STORAGE);
    return raw ? (JSON.parse(raw) as CodeReports) : {};
  } catch {
    return {};
  }
}

export async function generateCodeReport(code: string, occurrenceSummary: string, locale: Locale): Promise<SavedReport> {
  const briefing = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(24 * 30)));
  const md = await callClaude(
    withLanguage(CODE_SYSTEM_PROMPT, locale),
    `${briefing}\n\n---\n\n# FOCUS CODE: ${code}\n\nRecorded occurrences of ${code} (from the scan history above):\n${occurrenceSummary}`,
  );
  const report: SavedReport = { ts: new Date().toISOString().slice(0, 16).replace("T", " "), md, lang: locale };
  const all = getCodeReports();
  all[code] = report;
  localStorage.setItem(CODE_REPORTS_STORAGE, JSON.stringify(all));
  return report;
}
