import { assertEquals } from "jsr:@std/assert@1";
import { processOnce } from "../_shared/webhook.ts";

Deno.test("webhook processing skips an already claimed event", async () => {
  let handled = 0;
  const first = await processOnce(
    { claim: async () => true },
    "evt_1",
    "invoice.paid",
    async () => {
      handled += 1;
    },
  );
  const second = await processOnce(
    { claim: async () => false },
    "evt_1",
    "invoice.paid",
    async () => {
      handled += 1;
    },
  );
  assertEquals(first, true);
  assertEquals(second, false);
  assertEquals(handled, 1);
});
