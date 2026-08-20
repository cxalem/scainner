// One long-lived runtime for every Effect this app runs, instead of
// building a fresh Layer per call site. `ManagedRuntime` composes every
// service Layer once; `runPromise` is what queryFn/call sites use to run
// an Effect and get back a plain Promise (TanStack Query's own contract).
import { Layer, ManagedRuntime } from "effect";
import { AiServiceLive } from "@scainner/core";
import { DeviceServiceLive } from "@/core/services/device-service-live";

const AppLayer = Layer.mergeAll(DeviceServiceLive, AiServiceLive);

export const runtime = ManagedRuntime.make(AppLayer);

export const runPromise = runtime.runPromise;
