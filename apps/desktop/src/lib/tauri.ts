import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type EventCallback } from "@tauri-apps/api/event";

export const MOCK_MODE = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

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
