import { assertEquals } from "jsr:@std/assert@1";
import { consumeWithClient } from "../_shared/credits.ts";

Deno.test("credit consumption asks subscription allowance before balance", async () => {
  const calls: string[] = [];
  const source = await consumeWithClient({
    takeSubscription: async () => {
      calls.push("subscription");
      return true;
    },
    takeBalance: async () => {
      calls.push("balance");
      return true;
    },
  });
  assertEquals(source, "subscription");
  assertEquals(calls, ["subscription"]);
});

Deno.test("credit consumption falls back to purchased balance", async () => {
  const calls: string[] = [];
  const source = await consumeWithClient({
    takeSubscription: async () => {
      calls.push("subscription");
      return false;
    },
    takeBalance: async () => {
      calls.push("balance");
      return true;
    },
  });
  assertEquals(source, "credit");
  assertEquals(calls, ["subscription", "balance"]);
});
