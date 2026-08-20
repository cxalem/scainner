// Thin pass-through over @tauri-apps/api — routes to mock data when the app
// isn't running inside an actual Tauri window (no dongle, no backend). Every
// view imports `invoke`/`listen` from here instead of `@tauri-apps/api/*`
// directly, so the whole app is previewable with `pnpm dev` in a browser.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";
import { isMock, mockInvoke, mockListen } from "./mock";

export const MOCK_MODE = isMock();

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (MOCK_MODE) return mockInvoke<T>(cmd, args);
  return tauriInvoke<T>(cmd, args);
}

export function listen<T>(event: string, cb: EventCallback<T>): Promise<() => void> {
  if (MOCK_MODE) return mockListen<T>(event, cb);
  return tauriListen<T>(event, cb);
}
