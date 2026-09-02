import { Context, Effect, Layer, Schema } from "effect";
import { ApiError } from "../errors";

class AnthropicBlock extends Schema.Class<AnthropicBlock>("AnthropicBlock")({
  type: Schema.String,
  text: Schema.optional(Schema.String),
}) {}
class AnthropicMessage extends Schema.Class<AnthropicMessage>("AnthropicMessage")({
  content: Schema.Array(AnthropicBlock),
}) {}

export class AiService extends Context.Tag("AiService")<
  AiService,
  {
    readonly complete: (args: {
      apiKey: string;
      model: string;
      system: string;
      userContent: string;
    }) => Effect.Effect<string, ApiError>;
  }
>() {}

export const AiServiceLive = Layer.succeed(AiService, {
  complete: ({ apiKey, model, system, userContent }) =>
    Effect.gen(function* () {
      const res = yield* Effect.tryPromise({
        try: () =>
          fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: "user", content: userContent }] }),
          }),
        catch: (cause) => new ApiError({ detail: `Network error: ${String(cause)}` }),
      });

      if (!res.ok) {
        const detail = yield* Effect.tryPromise(() => res.json() as Promise<{ error?: { message?: string } }>).pipe(
          Effect.map((err) => (err.error?.message ? `${res.status}: ${err.error.message}` : `${res.status}`)),
          Effect.catchAll(() => Effect.succeed(`${res.status}`)),
        );
        return yield* Effect.fail(new ApiError({ detail: `Anthropic API error ${detail}` }));
      }

      const body = yield* Effect.tryPromise({
        try: () => res.json(),
        catch: (cause) => new ApiError({ detail: `Could not read the response: ${String(cause)}` }),
      });
      const message = yield* Schema.decodeUnknown(AnthropicMessage)(body).pipe(
        Effect.mapError((cause) => new ApiError({ detail: `Unexpected response shape: ${String(cause)}` })),
      );

      const md = message.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!md) return yield* Effect.fail(new ApiError({ detail: "Empty response from the model." }));
      return md;
    }),
});
