import { Badge } from "@/components/ui";

function fuelStatus(pct: number): { label: string; tone: "good" | "watch" | "bad" } {
  if (pct < 10) return { label: "Reserve", tone: "bad" };
  if (pct < 25) return { label: "Low", tone: "watch" };
  if (pct >= 90) return { label: "Full", tone: "good" };
  return { label: "Good", tone: "good" };
}

/** Visual tank gauge — the most recent reading, not a window average (a tank
 * level is a point-in-time fact, not a trend). Not every ECU reports this
 * PID over standard OBD2; the card degrades gracefully when it's absent. */
export function FuelLevelGauge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const status = fuelStatus(clamped);
  const fillColor =
    status.tone === "bad" ? "bg-destructive" : status.tone === "watch" ? "bg-warn" : "bg-primary";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-3xl font-semibold tabular-nums">
          {clamped.toFixed(0)}
          <span className="ml-1 text-sm font-normal text-muted-foreground">%</span>
        </p>
        <Badge variant={status.tone === "good" ? "ok" : status.tone === "watch" ? "warn" : "error"}>
          {status.label}
        </Badge>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Fuel tank ${clamped.toFixed(0)} percent, ${status.label.toLowerCase()}`}>
        {/* quarter-tick marks */}
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute inset-y-0 w-px bg-foreground/15" style={{ left: `${t}%` }} aria-hidden="true" />
        ))}
        <div
          className={`h-full origin-left rounded-full ${fillColor} motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-reduce:transition-none`}
          style={{ transform: `scaleX(${clamped / 100})`, width: "100%" }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>E</span>
        <span>F</span>
      </div>
    </div>
  );
}
