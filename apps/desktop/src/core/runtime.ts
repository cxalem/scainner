import { Layer, ManagedRuntime } from "effect";
import { DeviceServiceLive } from "@/core/services/device-service-live";
import { BillingServiceLive } from "@/core/services/billing-service-live";

const AppLayer = Layer.mergeAll(DeviceServiceLive, BillingServiceLive);

export const runtime = ManagedRuntime.make(AppLayer);

export const runPromise = runtime.runPromise;
