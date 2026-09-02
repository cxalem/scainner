import { describe, expect, it } from "vitest";
import { TOAST_DURATION_MS, toastDuration, toastRole, type ToastVariant } from "./toast";

const VARIANTS: ToastVariant[] = ["success", "info", "warning", "error"];

describe("toastDuration", () => {
  it("gives each variant its own default dwell time", () => {
    expect(toastDuration("success")).toBe(4000);
    expect(toastDuration("info")).toBe(6000);
    expect(toastDuration("warning")).toBe(6000);
    expect(toastDuration("error")).toBe(8000);
  });

  it("reads the defaults from one table, so a retune moves both", () => {
    for (const variant of VARIANTS) {
      expect(toastDuration(variant)).toBe(TOAST_DURATION_MS[variant]);
    }
  });

  it("gives a success less time than an error, in every direction", () => {
    expect(TOAST_DURATION_MS.success).toBeLessThan(TOAST_DURATION_MS.info);
    expect(TOAST_DURATION_MS.info).toBeLessThan(TOAST_DURATION_MS.error);
  });

  it("lets a caller override the default", () => {
    expect(toastDuration("success", { durationMs: 12000 })).toBe(12000);
  });

  it("never auto-dismisses a sticky toast, whatever else was asked for", () => {
    expect(toastDuration("success", { sticky: true })).toBe(Number.POSITIVE_INFINITY);
    expect(toastDuration("error", { sticky: true, durationMs: 500 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("stops the countdown while the Details disclosure is open", () => {
    expect(toastDuration("error", { detailsOpen: true })).toBe(Number.POSITIVE_INFINITY);
    expect(toastDuration("error", { detailsOpen: false })).toBe(8000);
  });

  it("reads a zero or negative duration as 'wait for me', not 'go now'", () => {
    expect(toastDuration("info", { durationMs: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(toastDuration("info", { durationMs: -1 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("toastRole", () => {
  it("interrupts for the two variants that report a problem", () => {
    expect(toastRole("error")).toBe("alert");
    expect(toastRole("warning")).toBe("alert");
  });

  it("stays polite for a receipt", () => {
    expect(toastRole("success")).toBe("status");
    expect(toastRole("info")).toBe("status");
  });
});
