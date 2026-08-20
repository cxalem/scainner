import { BatteryCharging, ClipboardList, Thermometer, Wind, Wrench } from "lucide-react";
import type { CarReport } from "@/features/vehicle/schema";

export type Verdict = {
  icon: typeof Wrench;
  title: string;
  text: string;
  status: "good" | "watch" | "bad";
};

// Reads Overview's report data into the plain-language Health summary
// cards. Pure function, no JSX, no hooks — a natural own-file split from
// the components that render its output (research.md section 4).
export function buildVerdicts(r: CarReport): Verdict[] {
  const i = r.insights;
  const v: Verdict[] = [];

  if (r.scans_total > 0) {
    const clean = r.scans_clean === r.scans_total;
    v.push({
      icon: ClipboardList,
      title: "Fault record",
      text: clean
        ? `All ${r.scans_total} diagnostic scans came back clean — the car has no stored faults.`
        : `${r.scans_total - r.scans_clean} of ${r.scans_total} scans found codes — check Diagnose.`,
      status: clean ? "good" : "watch",
    });
  }

  if (i.ltft_avg != null) {
    const a = Math.abs(i.ltft_avg);
    v.push({
      icon: Wrench,
      title: "Engine health",
      text:
        a < 5
          ? `Fuel trims are near zero (${i.ltft_avg.toFixed(1)}%) — the engine is breathing and fueling exactly as designed.`
          : a < 10
            ? `Fuel trims are slightly off (${i.ltft_avg.toFixed(1)}%) — nothing urgent, but worth watching the trend.`
            : `Fuel trims are far from zero (${i.ltft_avg.toFixed(1)}%) — the engine is compensating for something (possible air leak or sensor drift). Worth investigating.`,
      status: a < 5 ? "good" : a < 10 ? "watch" : "bad",
    });
  }

  if (i.coolant_max != null) {
    v.push({
      icon: Thermometer,
      title: "Cooling system",
      text: !i.coolant_reached_op
        ? `The engine hasn't reached full temperature in this period (max ${i.coolant_max.toFixed(0)}°C) — fine for short trips, but if it never reaches ~90°C on longer drives, the thermostat may be stuck open.`
        : i.coolant_max > 105
          ? `Coolant peaked at ${i.coolant_max.toFixed(0)}°C — hotter than it should ever get. Check coolant level.`
          : `Reaches proper operating temperature and never overheats (max ${i.coolant_max.toFixed(0)}°C). Thermostat and cooling system working as they should.`,
      status: !i.coolant_reached_op ? "watch" : i.coolant_max > 105 ? "bad" : "good",
    });
  }

  if (i.voltage_min != null && i.voltage_avg != null) {
    const low = i.voltage_min < 11.5;
    v.push({
      icon: BatteryCharging,
      title: "Battery & charging",
      text: low
        ? `Voltage dipped to ${i.voltage_min.toFixed(1)}V — deep dips can be normal during stop-start restarts, but if this trends down over weeks the battery is aging.`
        : `Charging system healthy. Lowest voltage seen: ${i.voltage_min.toFixed(1)}V (normal stop-start behaviour), average ${i.voltage_avg.toFixed(1)}V.`,
      status: low ? "watch" : "good",
    });
  }

  if (i.boost_max_kpa != null && i.baro_kpa != null) {
    const boost = i.boost_max_kpa - i.baro_kpa;
    if (boost > 20) {
      v.push({
        icon: Wind,
        title: "Turbo",
        text:
          boost > 80
            ? `Turbo reached ${(boost / 100).toFixed(1)} bar of boost — delivering full pressure, no signs of leaks or wastegate issues.`
            : `Turbo produced ${(boost / 100).toFixed(1)} bar of boost in this period — light driving; full-load health unknown until a harder run.`,
        status: "good",
      });
    }
  }

  return v;
}
