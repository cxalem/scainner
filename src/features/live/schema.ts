// Response type for the full-sensor-sweep surface (Live.tsx's "Read all
// sensors" button, also used one-shot by DiscoveryFlow's onboarding sweep).
import { Schema } from "effect";

export class SensorReading extends Schema.Class<SensorReading>("SensorReading")({
  pid: Schema.String,
  key: Schema.String,
  label: Schema.String,
  unit: Schema.String,
  value: Schema.Number,
}) {}
