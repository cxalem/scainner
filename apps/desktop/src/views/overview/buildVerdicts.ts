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
export function buildVerdicts(report: CarReport): Verdict[] {
  const insights = report.insights;
  const verdicts: Verdict[] = [];

  if (report.scans_total > 0) {
    const clean = report.scans_clean === report.scans_total;
    verdicts.push({
      icon: ClipboardList,
      title: "Fault record",
      text: clean
        ? `All ${report.scans_total} diagnostic scans came back clean — the car has no stored faults.`
        : `${report.scans_total - report.scans_clean} of ${report.scans_total} scans found codes — check Diagnose.`,
      status: clean ? "good" : "watch",
    });
  }

  if (insights.ltft_avg != null) {
    const absLtft = Math.abs(insights.ltft_avg);
    verdicts.push({
      icon: Wrench,
      title: "Engine health",
      text:
        absLtft < 5
          ? `Fuel trims are near zero (${insights.ltft_avg.toFixed(1)}%) — the engine is breathing and fueling exactly as designed.`
          : absLtft < 10
            ? `Fuel trims are slightly off (${insights.ltft_avg.toFixed(1)}%) — nothing urgent, but worth watching the trend.`
            : `Fuel trims are far from zero (${insights.ltft_avg.toFixed(1)}%) — the engine is compensating for something (possible air leak or sensor drift). Worth investigating.`,
      status: absLtft < 5 ? "good" : absLtft < 10 ? "watch" : "bad",
    });
  }

  if (insights.coolant_max != null) {
    verdicts.push({
      icon: Thermometer,
      title: "Cooling system",
      text: !insights.coolant_reached_op
        ? `The engine hasn't reached full temperature in this period (max ${insights.coolant_max.toFixed(0)}°C) — fine for short trips, but if it never reaches ~90°C on longer drives, the thermostat may be stuck open.`
        : insights.coolant_max > 105
          ? `Coolant peaked at ${insights.coolant_max.toFixed(0)}°C — hotter than it should ever get. Check coolant level.`
          : `Reaches proper operating temperature and never overheats (max ${insights.coolant_max.toFixed(0)}°C). Thermostat and cooling system working as they should.`,
      status: !insights.coolant_reached_op ? "watch" : insights.coolant_max > 105 ? "bad" : "good",
    });
  }

  if (insights.voltage_min != null && insights.voltage_avg != null) {
    const low = insights.voltage_min < 11.5;
    verdicts.push({
      icon: BatteryCharging,
      title: "Battery & charging",
      text: low
        ? `Voltage dipped to ${insights.voltage_min.toFixed(1)}V — deep dips can be normal during stop-start restarts, but if this trends down over weeks the battery is aging.`
        : `Charging system healthy. Lowest voltage seen: ${insights.voltage_min.toFixed(1)}V (normal stop-start behaviour), average ${insights.voltage_avg.toFixed(1)}V.`,
      status: low ? "watch" : "good",
    });
  }

  if (insights.boost_max_kpa != null && insights.baro_kpa != null) {
    const boost = insights.boost_max_kpa - insights.baro_kpa;
    if (boost > 20) {
      verdicts.push({
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

  return verdicts;
}
