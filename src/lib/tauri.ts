// Thin pass-through over @tauri-apps/api — routes to mock data when the app
// isn't running inside an actual Tauri window (no dongle, no backend). Every
// view imports `invoke`/`listen` from here instead of `@tauri-apps/api/*`
// directly, so the whole app is previewable with `pnpm dev` in a browser.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";

export const MOCK_MODE = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

// mock.ts carries demo data plus a hand-rolled event bus that a real Tauri
// build never needs. Loaded only when MOCK_MODE is true, via one cached
// dynamic import, so it no longer rides along unconditionally in the eager
// main chunk of a real build (it used to be a plain module-scope import —
// see docs/workflows/app-perf/research.md section 3).
const mockModule = MOCK_MODE ? import("./mock") : null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (MOCK_MODE) {
    const { mockInvoke } = await mockModule!;
    return mockInvoke<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd, args);
}

export async function listen<T>(event: string, cb: EventCallback<T>): Promise<() => void> {
  if (MOCK_MODE) {
    const { mockListen } = await mockModule!;
    return mockListen<T>(event, cb);
  }
  return tauriListen<T>(event, cb);
}
