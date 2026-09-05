import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CatalogItemKey } from "@scainner/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { billingRun, usePricing } from "@/features/reports/queries";
import { useLocale } from "@/i18n";
import { formatPrice } from "@/lib/reports";
import { MOCK_MODE } from "@/lib/tauri";
import { toast } from "@/components/toast";

const ITEMS: CatalogItemKey[] = ["single", "pack_5", "pack_20", "subscription_monthly"];
const COPY = {
  en: { title: "Buy AI reports", description: "Credits work for ride and fault-code reports.", labels: { single: "One report", pack_5: "Pack of 5", pack_20: "Pack of 20", subscription_monthly: "Monthly allowance" }, open: "Continue", failed: "Could not open checkout", close: "Close" },
  es: { title: "Comprar informes con IA", description: "Los créditos sirven para informes de trayectos y códigos.", labels: { single: "Un informe", pack_5: "Pack de 5", pack_20: "Pack de 20", subscription_monthly: "Cupo mensual" }, open: "Continuar", failed: "No se pudo abrir el pago", close: "Cerrar" },
} as const;

export function BillingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const pricing = usePricing();
  const [busy, setBusy] = useState<CatalogItemKey | null>(null);

  const checkout = async (item: CatalogItemKey) => {
    setBusy(item);
    try {
      const url = await billingRun((billing) => billing.createCheckout(item));
      if (!MOCK_MODE) await openUrl(url);
      onOpenChange(false);
    } catch (error) {
      toast.error(copy.failed, { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.close}>
        <DialogHeader><DialogTitle>{copy.title}</DialogTitle><DialogDescription>{copy.description}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {ITEMS.map((item) => (
            <div key={item} className="flex min-h-28 flex-col rounded-md bg-muted p-4">
              <p className="font-medium">{copy.labels[item]}</p>
              <p className="num mt-1 text-lg text-accent-300">{formatPrice(pricing.data?.catalog[item], locale)}{item === "subscription_monthly" ? (locale === "es" ? "/mes" : "/month") : ""}</p>
              <span className="flex-1" />
              <Button className="mt-3 min-h-10" variant="outline" disabled={busy != null || pricing.isPending} onClick={() => void checkout(item)}>{busy === item ? "…" : copy.open}</Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
