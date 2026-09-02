export type CreditState = {
  subscriptionActive: boolean;
  allowanceUsed: number;
  monthlyAllowance: number;
  balance: number;
};

export type CreditSource = "subscription" | "credit" | "none";

export function consumeCreditState(
  state: CreditState,
): { source: CreditSource; state: CreditState } {
  if (
    state.subscriptionActive && state.allowanceUsed < state.monthlyAllowance
  ) {
    return {
      source: "subscription",
      state: { ...state, allowanceUsed: state.allowanceUsed + 1 },
    };
  }
  if (state.balance > 0) {
    return {
      source: "credit",
      state: { ...state, balance: state.balance - 1 },
    };
  }
  return { source: "none", state };
}

export type CreditClient = {
  takeSubscription: () => Promise<boolean>;
  takeBalance: () => Promise<boolean>;
};

export async function consumeWithClient(
  client: CreditClient,
): Promise<CreditSource> {
  if (await client.takeSubscription()) return "subscription";
  if (await client.takeBalance()) return "credit";
  return "none";
}
