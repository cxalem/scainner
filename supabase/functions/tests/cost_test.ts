import { assertEquals } from "jsr:@std/assert@1";
import { costUsd } from "../_shared/cost.ts";

Deno.test("opus 5 cost includes input output and cache token classes", () => {
  assertEquals(
    costUsd({
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    }),
    36.75,
  );
});
