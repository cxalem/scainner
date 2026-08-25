// Public surface of @scainner/core: the Effect-based domain schemas and
// service contracts shared by every app in the monorepo. Concrete Live
// layers for transport-specific services (DeviceService today) live in the
// consuming app, not here — see services/device-service.ts's own comment.
export * from "./errors";

export * from "./schema/connection";
export * from "./schema/diagnostic-outcome";
export * from "./schema/vehicle";
export * from "./schema/diagnose";
export * from "./schema/lab";
export * from "./schema/live";
export * from "./schema/history";

export * from "./services/device-service";
export * from "./services/ai-service";
