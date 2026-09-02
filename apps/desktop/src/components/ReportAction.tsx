import { Fragment, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GenerateReportInput, ReportRow } from "@scainner/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/features/account/useSession";
import { billingRun, usePricing } from "@/features/reports/queries";
import { useLocale, useT } from "@/i18n";
import { formatPrice, reportButtonState, reportFactsParts, reportOfferKeys } from "@/lib/reports";
import { MOCK_MODE } from "@/lib/tauri";
import { toast } from "@/components/toast";
import { ReportView } from "@/views/reports/ReportView";

type ReportSubject =
  | { kind: "ride"; ride_id: string; minutes: number; sensor_count: number; sample_count: number; dtc_codes_appeared: number }
  | { kind: "code"; scan_event_id?: string; dtc_code: string };

export function ReportAction({ input }: { input: ReportSubject }) {
  const { locale } = useLocale();
  const t = useT();
  const copy = t.reportOffer;
  const queryClient = useQueryClient();
  const session = useSession();
  const previewSignedOut = MOCK_MODE && new URLSearchParams(window.location.search).get("report-state") === "signed-out";
  const signedIn = !previewSignedOut && typeof session === "string";
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [report, setReport] = useState<ReportRow | null>(null);
  const startingEntitlement = useRef(0);
  const pricing = usePricing(waiting ? 1000 : false);
  const balance = pricing.data?.account?.balance ?? 0;
  const subscription = pricing.data?.account?.subscription ?? null;
  const offer = reportOfferKeys({ signedIn, balance, subscription });
  const entitlement = balance + offer.planLeft;
  const state = reportButtonState({ signedIn, balance: entitlement, waiting, generating, done: report != null });
  const price = formatPrice(pricing.data?.catalog.single, locale);
  const facts = input.kind === "ride"
    ? reportFactsParts({ kind: "ride", minutes: input.minutes, sensors: input.sensor_count, samples: input.sample_count, codes: input.dtc_codes_appeared }, locale)
    : reportFactsParts({ kind: "code", code: input.dtc_code, module: t.diagnose.confirmClear.module }, locale);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setPhase((value) => (value + 1) % copy.writing.length), 1800);
    return () => window.clearInterval(timer);
  }, [copy.writing.length, generating]);

  useEffect(() => {
    if (waiting && entitlement > startingEntitlement.current) {
      setWaiting(false);
      setOpen(false);
      toast.success(copy.bought);
      void generate();
    }
  }, [copy.bought, entitlement, waiting]);

  const generate = async () => {
    setGenerating(true);
    setPhase(0);
    try {
      const subject: GenerateReportInput = input.kind === "ride"
        ? { kind: "ride", ride_id: input.ride_id, locale }
        : { kind: "code", scan_event_id: input.scan_event_id, dtc_code: input.dtc_code, locale };
      const result = await billingRun((billing) => billing.generateReport(subject));
      const row = await billingRun((billing) => billing.getReport(result.report_id));
      setReport(row);
      toast.success(copy.complete);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void pricing.refetch();
    } catch (error) {
      toast.error(copy.failed, { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setGenerating(false);
    }
  };

  const confirm = async () => {
    if (!signedIn) {
      setOpen(false);
      toast.info(copy.signInToast);
      return;
    }
    if (entitlement > 0) {
      setOpen(false);
      await generate();
      return;
    }
    try {
      startingEntitlement.current = entitlement;
      const url = await billingRun((billing) => billing.createCheckout("single"));
      if (!MOCK_MODE) await openUrl(url);
      setWaiting(true);
    } catch (error) {
      toast.error(copy.failed, { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const costLine = offer.cost === "plan" && subscription
    ? copy.cost.plan(offer.planLeft, subscription.monthly_allowance)
    : offer.cost === "credit"
      ? copy.cost.credit(balance)
      : copy.cost.price(price);
  const primaryLabel = offer.primary === "signedOut"
    ? copy.primary.signedOut
    : offer.primary === "covered"
      ? copy.primary.covered
      : copy.primary.price(price);
  const buttonLabel = state === "generating" ? copy.writing[phase] : state === "done" ? copy.open : copy.getReport;

  return (
    <>
      <Button className="min-h-10" disabled={generating || pricing.isPending} aria-busy={generating || undefined} onClick={() => report ? setReport(report) : setOpen(true)}>{buttonLabel}</Button>
      <Dialog open={open} onOpenChange={(next) => !waiting && setOpen(next)}>
        <DialogContent className="max-w-sm overflow-hidden" closeLabel={t.common.close} showCloseButton={!waiting}>
          <DialogHeader>
            <DialogTitle>{input.kind === "ride" ? copy.rideTitle : copy.codeTitle(input.dtc_code)}</DialogTitle>
            <DialogDescription>{input.kind === "ride" ? copy.rideDescription : copy.codeDescription}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{copy.structure}</p>
          <p className="text-xs text-muted-foreground">
            {facts.map((part, index) => (
              <Fragment key={part}>
                {index > 0 && <>&nbsp;· </>}
                <span className="whitespace-nowrap">{part}</span>
              </Fragment>
            ))}
          </p>
          <p className="text-sm text-muted-foreground" aria-live="polite">{waiting ? copy.waiting : costLine}</p>
          <p className="text-xs text-muted-foreground">{copy.privacy}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={waiting} onClick={() => setOpen(false)}>{copy.notNow}</Button>
            <Button disabled={waiting || pricing.isPending} aria-busy={waiting || undefined} onClick={() => void confirm()}>{primaryLabel}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {report && <ReportView report={report} onClose={() => setReport(null)} />}
    </>
  );
}
