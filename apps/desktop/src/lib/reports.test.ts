import { describe, expect, it } from "vitest";
import { formatPrice, reportButtonState } from "./reports";

describe("report button state", () => {
  it.each([
    [{ signedIn: false, balance: 0, waiting: false, generating: false, done: false }, "signed_out"],
    [{ signedIn: true, balance: 0, waiting: false, generating: false, done: false }, "no_credit"],
    [{ signedIn: true, balance: 1, waiting: false, generating: false, done: false }, "ready"],
    [{ signedIn: true, balance: 0, waiting: true, generating: false, done: false }, "waiting"],
    [{ signedIn: true, balance: 1, waiting: false, generating: true, done: false }, "generating"],
    [{ signedIn: true, balance: 0, waiting: false, generating: false, done: true }, "done"],
  ] as const)("resolves %s", (input, expected) => expect(reportButtonState(input)).toBe(expected));
});

describe("report price formatting", () => {
  it("formats Stripe minor units", () => {
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "en")).toBe("€4.99");
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "es")).toMatch(/4,99/);
  });
});
