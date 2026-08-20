// Tagged errors for the Effect layer. Every raw `invoke()` rejection in the
// app used to become `String(e instanceof Error ? e.message : e)`, hand
// written per call site (research.md section 2) — this is the one shared
// shape instead. `Schema.decodeUnknown` failures use Effect's own
// `ParseError`, not redefined here.
import { Data } from "effect";

export class InvokeError extends Data.TaggedError("InvokeError")<{
  readonly command: string;
  readonly cause: unknown;
}> {
  // Effect.runPromise rejects with a FiberFailure that forwards this
  // getter as `.message` — confirmed directly (see plan.md) — so views'
  // existing `error instanceof Error ? error.message : error` idiom needs
  // no changes to keep working against Effect-backed hooks.
  get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `${this.command} failed: ${detail}`;
  }
}

// Phase 3 (AI layer): wraps a non-ok fetch response or an empty model reply,
// same two failure shapes ai.ts's callClaude already throws as plain Error.
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly detail: string;
}> {
  get message() {
    return this.detail;
  }
}
