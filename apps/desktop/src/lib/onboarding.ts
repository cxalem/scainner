// Tracks whether the one-time first-run onboarding (today: just a language
// confirmation screen — product-plan.md's 2026-08-21 decision keeps this
// deliberately minimal for v1, no account/data capture) has already been
// shown. Persisted across launches, unlike App.tsx's session-only
// hasConnectedOnce — this should never show twice on the same install.
const STORAGE_KEY = "scainner.onboarded";

export function hasOnboarded(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function markOnboarded(): void {
  window.localStorage.setItem(STORAGE_KEY, "1");
}
