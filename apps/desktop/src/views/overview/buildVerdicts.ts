import { BatteryCharging, ClipboardList, Thermometer, Wind, Wrench } from "lucide-react";
import type { CarReport } from "@scainner/core";
import type { Dictionary } from "@/i18n";

export type Verdict = {
  icon: typeof Wrench;
  title: string;
  text: string;
  status: "good" | "watch" | "bad";
};

// Reads Overview's report data into the plain-language Health summary
// cards. Pure function, no JSX, no hooks — a natural own-file split from
// the components that render its output (research.md section 4).
//
// Takes `t` as a parameter rather than calling useT() itself, same as
// components/WriteHistory.tsx's summary() — this needs to stay a plain,
// testable function, not a component or a hook.
export function buildVerdicts(report: CarReport, t: Dictionary): Verdict[] {
  const insights = report.insights;
  const h = t.overview.health;
  const verdicts: Verdict[] = [];

  if (report.scans_total > 0) {
    const clean = report.scans_clean === report.scans_total;
    verdicts.push({
      icon: ClipboardList,
      title: h.faultRecordTitle,
      text: clean
        ? h.faultRecordClean(report.scans_total)
        : h.faultRecordSome(report.scans_total - report.scans_clean, report.scans_total),
      status: clean ? "good" : "watch",
    });
  }

  if (insights.ltft_avg != null) {
    const absLtft = Math.abs(insights.ltft_avg);
    const ltftStr = insights.ltft_avg.toFixed(1);
    verdicts.push({
      icon: Wrench,
      title: h.engineHealthTitle,
      text: absLtft < 5 ? h.engineHealthGood(ltftStr) : absLtft < 10 ? h.engineHealthWatch(ltftStr) : h.engineHealthBad(ltftStr),
      status: absLtft < 5 ? "good" : absLtft < 10 ? "watch" : "bad",
    });
  }

  if (insights.coolant_max != null) {
    const maxTempStr = insights.coolant_max.toFixed(0);
    verdicts.push({
      icon: Thermometer,
      title: h.coolingTitle,
      text: !insights.coolant_reached_op
        ? h.coolingNeverReached(maxTempStr)
        : insights.coolant_max > 105
          ? h.coolingOverheating(maxTempStr)
          : h.coolingGood(maxTempStr),
      status: !insights.coolant_reached_op ? "watch" : insights.coolant_max > 105 ? "bad" : "good",
    });
  }

  if (insights.voltage_min != null && insights.voltage_avg != null) {
    const low = insights.voltage_min < 11.5;
    verdicts.push({
      icon: BatteryCharging,
      title: h.batteryTitle,
      text: low
        ? h.batteryLow(insights.voltage_min.toFixed(1))
        : h.batteryGood(insights.voltage_min.toFixed(1), insights.voltage_avg.toFixed(1)),
      status: low ? "watch" : "good",
    });
  }

  if (insights.boost_max_kpa != null && insights.baro_kpa != null) {
    const boost = insights.boost_max_kpa - insights.baro_kpa;
    if (boost > 20) {
      const barStr = (boost / 100).toFixed(1);
      verdicts.push({
        icon: Wind,
        title: h.turboTitle,
        text: boost > 80 ? h.turboFull(barStr) : h.turboLight(barStr),
        status: "good",
      });
    }
  }

  return verdicts;
}
