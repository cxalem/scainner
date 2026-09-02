import { describe, expect, it } from "vitest";
import { formatPrice, reportButtonState, reportOfferKeys } from "./reports";

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

describe("report offer copy keys", () => {
  it.each([
    [{ signedIn: true, balance: 0, subscription: null }, { cost: "price", primary: "price", planLeft: 0 }],
    [{ signedIn: true, balance: 3, subscription: null }, { cost: "credit", primary: "covered", planLeft: 0 }],
    [{ signedIn: true, balance: 3, subscription: { monthly_allowance: 5, allowance_used: 2 } }, { cost: "plan", primary: "covered", planLeft: 3 }],
    [{ signedIn: false, balance: 0, subscription: null }, { cost: "price", primary: "signedOut", planLeft: 0 }],
  ] as const)("maps %o", (input, expected) => expect(reportOfferKeys(input)).toEqual(expected));
});

describe("report price formatting", () => {
  it("formats Stripe minor units", () => {
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "en")).toBe("€4.99");
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "es")).toMatch(/4,99/);
  });
});
