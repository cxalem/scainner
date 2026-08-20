import { useState } from "react";
import { Fuel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, useTransientLabel } from "@/components/ui";
import type { Insights } from "@/features/vehicle/schema";
import { useSetFuelPrice } from "@/features/vehicle/queries";
import { FuelLevelGauge } from "@/views/overview/FuelLevelGauge";

export function FuelCard({ insights: i }: { insights: Insights }) {
  const [price, setPrice] = useState(String(i.fuel_price));
  const setFuelPrice = useSetFuelPrice();
  const [savedLabel, flashSaved] = useTransientLabel();
  const days = i.window_hours >= 24 * 365 ? "all time" : `last ${Math.round(i.window_hours / 24)} days`;
  const hasLevel = i.fuel_level_pct != null;
  const hasConsumption = i.fuel_lph_avg != null;

  if (!hasLevel && !hasConsumption)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No fuel data yet — it collects automatically on your next drive.
          </p>
        </CardContent>
      </Card>
    );

  const eur100 = i.l_per_100km != null ? i.l_per_100km * i.fuel_price : null;
  const totalCost = i.fuel_total_l != null ? i.fuel_total_l * i.fuel_price : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Fuel className="h-4 w-4" aria-hidden="true" /> Fuel{hasConsumption ? ` — ${days}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasLevel && <FuelLevelGauge pct={i.fuel_level_pct!} />}
        {!hasLevel && hasConsumption && (
          // Honest absence beats silent absence. Verified against real data:
          // the C4 answered every polled PID thousands of times except fuel
          // level (PID 012F), zero answers ever. PSA keeps tank level in the
          // BSI body computer, which is not reachable over standard OBD2 or
          // this dongle's UDS path (see UDS_INVESTIGATION_LOG.md).
          <p className="text-xs text-muted-foreground">
            This car does not report its tank level over standard OBD2, so there is no fuel gauge here.
            Consumption below comes from the engine and works normally.
          </p>
        )}

        {hasConsumption ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Consumption</p>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {i.l_per_100km != null ? i.l_per_100km.toFixed(1) : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">L/100km</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cost per 100 km</p>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {eur100 != null ? eur100.toFixed(2) : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">EUR</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fuel used (~)</p>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {i.fuel_total_l != null ? i.fuel_total_l.toFixed(1) : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  L{totalCost != null ? ` · ${totalCost.toFixed(2)} EUR` : ""}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Distance (~)</p>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {i.km_total != null ? i.km_total.toFixed(0) : "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">km</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Consumption stats collect automatically on your next drive.
          </p>
        )}

        {hasConsumption && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="fuel-price">Fuel price:</label>
            <input
              id="fuel-price"
              inputMode="decimal"
              className="h-7 w-16 rounded-md border border-border bg-card px-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <span>EUR/L</span>
            <button
              className="rounded text-primary hover:underline disabled:pointer-events-none disabled:opacity-50 transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={setFuelPrice.isPending}
              onClick={() =>
                setFuelPrice.mutate(
                  { price: parseFloat(price) || 1.5 },
                  { onSuccess: () => flashSaved("saved") },
                )
              }
            >
              {setFuelPrice.isPending ? "saving…" : savedLabel === "saved" ? "saved" : "save"}
            </button>
            {setFuelPrice.isError && <span className="text-destructive">Could not save. Try again.</span>}
            <span className="ml-2">Includes idling. ECU-reported, ±5–10%.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
