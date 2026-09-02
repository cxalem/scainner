const STORAGE_KEY = "scainner.onboarded";

export function hasOnboarded(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function markOnboarded(): void {
  window.localStorage.setItem(STORAGE_KEY, "1");
}
