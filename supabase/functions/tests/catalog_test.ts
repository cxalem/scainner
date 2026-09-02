import { assertEquals } from "jsr:@std/assert@1";
import { creditsForItem, itemForPrice } from "../_shared/catalog.ts";

Deno.test("price map assigns configured credit quantities", () => {
  assertEquals(creditsForItem("single"), 1);
  assertEquals(creditsForItem("pack_5"), 5);
  assertEquals(creditsForItem("pack_20"), 20);
  assertEquals(creditsForItem("subscription_monthly"), 0);
  assertEquals(
    itemForPrice("price_pack", {
      single: "price_single",
      pack_5: "price_pack",
      pack_20: "price_large",
      subscription_monthly: "price_monthly",
    }),
    "pack_5",
  );
});
