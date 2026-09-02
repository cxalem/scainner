import { Data } from "effect";

export class InvokeError extends Data.TaggedError("InvokeError")<{
  readonly command: string;
  readonly cause: unknown;
}> {
  get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `${this.command} failed: ${detail}`;
  }
}

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly detail: string;
}> {
  get message() {
    return this.detail;
  }
}
