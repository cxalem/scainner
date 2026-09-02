import { describe, expect, it } from "vitest";
import { formatPrice, reportButtonState, reportFacts, reportOfferKeys } from "./reports";

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

describe("report facts line", () => {
  const ride = { kind: "ride", minutes: 14, sensors: 33, samples: 9839 } as const;

  it("lists what a ride report covers", () => {
    expect(reportFacts({ ...ride, codes: 0 }, "en")).toBe("14 min · 33 sensors · 9,839 samples · no fault codes");
    expect(reportFacts({ ...ride, codes: 0 }, "es")).toBe("14 min · 33 sensores · 9.839 muestras · sin códigos de avería");
  });

  it("counts fault codes", () => {
    expect(reportFacts({ ...ride, codes: 1 }, "en")).toBe("14 min · 33 sensors · 9,839 samples · 1 fault code");
    expect(reportFacts({ ...ride, codes: 2 }, "en")).toBe("14 min · 33 sensors · 9,839 samples · 2 fault codes");
    expect(reportFacts({ ...ride, codes: 1 }, "es")).toBe("14 min · 33 sensores · 9.839 muestras · 1 código de avería");
    expect(reportFacts({ ...ride, codes: 2 }, "es")).toBe("14 min · 33 sensores · 9.839 muestras · 2 códigos de avería");
  });

  it("names the code and its module", () => {
    expect(reportFacts({ kind: "code", code: "P0301", module: "Engine (OBD)" }, "en")).toBe("P0301 · Engine (OBD)");
    expect(reportFacts({ kind: "code", code: "P0301", module: "Motor (OBD)" }, "es")).toBe("P0301 · Motor (OBD)");
  });
});

describe("report price formatting", () => {
  it("formats Stripe minor units", () => {
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "en")).toBe("€4.99");
    expect(formatPrice({ price_id: "price_1", currency: "eur", unit_amount: 499 }, "es")).toMatch(/4,99/);
  });
});
