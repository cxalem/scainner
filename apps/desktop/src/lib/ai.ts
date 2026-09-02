import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { AiService, DeviceService } from "@scainner/core";
import type { Locale } from "@/i18n";

const SPANISH_INSTRUCTION =
  "\n\nWrite your entire response in Spanish (español). Translate the section headings naturally into Spanish too — keep the same markdown structure (##, numbered lists), just written in Spanish throughout.";

function withLanguage(systemPrompt: string, locale: Locale): string {
  return locale === "es" ? systemPrompt + SPANISH_INSTRUCTION : systemPrompt;
}

const KEY_STORAGE = "scainner.anthropic_api_key";
const REPORT_STORAGE = "scainner.last_ai_report";

export const AI_PHASES = ["Sending briefing…", "Waiting for the model…", "Writing report…"] as const;

const MODEL = "claude-sonnet-5";

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key: string) {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

export type SavedReport = { ts: string; md: string; lang: Locale; vehicleId: number | null };

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

async function callClaude(system: string, userContent: string): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error("No API key configured.");
  return runPromise(Effect.flatMap(AiService, (ai) => ai.complete({ apiKey: key, model: MODEL, system, userContent })));
}

export async function generateDiagnosisReport(vehicleId: number | null, locale: Locale): Promise<SavedReport> {
  const briefing = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(vehicleId, 24 * 30)));
  const md = await callClaude(withLanguage(SYSTEM_PROMPT, locale), briefing);
  const report: SavedReport = { ts: new Date().toISOString().slice(0, 16).replace("T", " "), md, lang: locale, vehicleId };
  localStorage.setItem(REPORT_STORAGE, JSON.stringify(report));
  return report;
}


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

export async function generateCodeReport(vehicleId: number | null, code: string, occurrenceSummary: string, locale: Locale): Promise<SavedReport> {
  const briefing = await runPromise(Effect.flatMap(DeviceService, (device) => device.aiContext(vehicleId, 24 * 30)));
  const md = await callClaude(
    withLanguage(CODE_SYSTEM_PROMPT, locale),
    `${briefing}\n\n---\n\n# FOCUS CODE: ${code}\n\nRecorded occurrences of ${code} (from the scan history above):\n${occurrenceSummary}`,
  );
  const report: SavedReport = { ts: new Date().toISOString().slice(0, 16).replace("T", " "), md, lang: locale, vehicleId };
  const all = getCodeReports();
  all[`${vehicleId ?? "unidentified"}:${code}`] = report;
  localStorage.setItem(CODE_REPORTS_STORAGE, JSON.stringify(all));
  return report;
}
