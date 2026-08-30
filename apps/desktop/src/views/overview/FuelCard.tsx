// Fuel and range: the last tank reading as a big number over a gauge bar,
// consumption figures underneath, and the editable price assumption they
// depend on. Degrades honestly when the car reports no tank level.
import { useState } from "react";
import { Fuel } from "lucide-react";
import { Button, Card, CardHead, Mono, ProgressBar, useTransientLabel } from "@/components/ui";
import type { Insights } from "@scainner/core";
import { useSetFuelPrice } from "@/features/vehicle/queries";
import { useT } from "@/i18n";

export function FuelCard({ vehicleId, insights: i, live = false }: { vehicleId: number; insights: Insights; live?: boolean }) {
  const t = useT();
  const [price, setPrice] = useState(String(i.fuel_price));
  const setFuelPrice = useSetFuelPrice();
  const [savedLabel, flashSaved] = useTransientLabel();
  const days =
    i.window_hours >= 24 * 365 ? t.overview.fuel.allTime : t.overview.fuel.lastNDays(Math.round(i.window_hours / 24));
  const hasLevel = i.fuel_level_pct != null;
  const hasConsumption = i.fuel_lph_avg != null;
  const pct = hasLevel ? Math.max(0, Math.min(100, i.fuel_level_pct!)) : null;

  // No magic default: a price that fails to parse must never silently save
  // as a made-up number — it feeds cost-per-100km below.
  const parsedPrice = parseFloat(price);
  const isValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0;
  const eur100 = i.l_per_100km != null ? i.l_per_100km * i.fuel_price : null;

  return (
    <Card className="gap-[11px]">
      <CardHead
        icon={Fuel}
        title={hasConsumption ? t.overview.fuel.cardTitleWithRange(days) : t.overview.fuel.cardTitle}
        aside={hasLevel ? (live ? t.overview.fuel.sourceLive : t.overview.fuel.sourceLast) : undefined}
      />

      {!hasLevel && !hasConsumption ? (
        <span className="text-[12.5px] text-neutral-500">{t.overview.fuel.noData}</span>
      ) : (
        <>
          {pct != null && (
            <>
              <div className="flex items-end gap-3.5">
                <Mono className="text-[30px] leading-none text-neutral-100">
                  {pct.toFixed(0)}
                  <span className="text-[14px] text-neutral-500"> %</span>
                </Mono>
                {i.l_per_100km != null && (
                  <span className="pb-[3px] text-[12.5px] text-neutral-500">{t.overview.fuel.perHundred(i.l_per_100km.toFixed(1))}</span>
                )}
              </div>
              <ProgressBar value={pct} tone="gradient" height={6} />
            </>
          )}
          {pct == null && <span className="text-[11.5px] text-neutral-500">{t.overview.fuel.noGaugeExplainer}</span>}

          {hasConsumption ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-neutral-500">
              <span>
                {t.overview.fuel.costPer100km}: <Mono className="text-neutral-300">{eur100 != null ? eur100.toFixed(2) : "—"} EUR</Mono>
              </span>
              <span>
                {t.overview.fuel.fuelUsed}: <Mono className="text-neutral-300">{i.fuel_total_l != null ? i.fuel_total_l.toFixed(1) : "—"} L</Mono>
              </span>
              <span>
                {t.overview.fuel.distance}: <Mono className="text-neutral-300">{i.km_total != null ? i.km_total.toFixed(0) : "—"} km</Mono>
              </span>
            </div>
          ) : (
            <span className="text-[11.5px] text-neutral-500">{t.overview.fuel.noConsumptionYet}</span>
          )}

          {hasConsumption && (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-500">
              <label htmlFor="fuel-price">{t.overview.fuel.priceLabel}</label>
              <input
                id="fuel-price"
                inputMode="decimal"
                aria-invalid={!isValidPrice}
                className="num h-7 w-16 rounded-md border border-divider bg-surface px-2 text-[12px] text-text focus-visible:border-accent focus-visible:outline-none aria-[invalid=true]:border-stop"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <span>EUR/L</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!isValidPrice}
                busy={setFuelPrice.isPending}
                onClick={() =>
                  setFuelPrice.mutate({ vehicleId, price: parsedPrice }, { onSuccess: () => flashSaved("saved") })
                }
              >
                {setFuelPrice.isPending ? t.overview.fuel.saving : savedLabel === "saved" ? t.overview.fuel.saved : t.overview.fuel.save}
              </Button>
              {!isValidPrice && <span className="text-stop">{t.overview.fuel.invalidPrice}</span>}
              {isValidPrice && setFuelPrice.isError && <span className="text-stop">{t.overview.fuel.saveFailed}</span>}
            </div>
          )}
          <span className="text-[11.5px] text-neutral-500">{t.overview.fuel.estimateNote}</span>
        </>
      )}
    </Card>
  );
}
