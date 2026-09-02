import { Schema } from "effect";

export class SensorReading extends Schema.Class<SensorReading>("SensorReading")({
  pid: Schema.String,
  key: Schema.String,
  label: Schema.String,
  unit: Schema.String,
  value: Schema.Number,
}) {}
