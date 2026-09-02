import { Layer, ManagedRuntime } from "effect";
import { AiServiceLive } from "@scainner/core";
import { DeviceServiceLive } from "@/core/services/device-service-live";

const AppLayer = Layer.mergeAll(DeviceServiceLive, AiServiceLive);

export const runtime = ManagedRuntime.make(AppLayer);

export const runPromise = runtime.runPromise;
