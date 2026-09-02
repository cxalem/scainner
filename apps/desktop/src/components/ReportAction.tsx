import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GenerateReportInput, ReportRow } from "@scainner/core";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/account/useSession";
import { billingRun, usePricing } from "@/features/reports/queries";
import { useLocale } from "@/i18n";
import { formatPrice, reportButtonState } from "@/lib/reports";
import { MOCK_MODE } from "@/lib/tauri";
import { toast } from "@/components/toast";
import { ReportView } from "@/views/reports/ReportView";

const COPY = {
  en: {
    signIn: "Sign in to get a report",
    signInToast: "Sign in from Vehicle to buy reports.",
    waiting: "Waiting for payment…",
    writing: ["Preparing the briefing…", "Reading the evidence…", "Writing your report…"],
    open: "Open report",
    cancel: "Cancel",
    failed: "Could not write the report",
    bought: "Payment received. Writing your report…",
  },
  es: {
    signIn: "Inicia sesión para obtener un informe",
    signInToast: "Inicia sesión desde Vehículo para comprar informes.",
    waiting: "Esperando el pago…",
    writing: ["Preparando el resumen…", "Leyendo las pruebas…", "Redactando tu informe…"],
    open: "Abrir informe",
    cancel: "Cancelar",
    failed: "No se pudo redactar el informe",
    bought: "Pago recibido. Redactando tu informe…",
  },
} as const;

type ReportSubject = { kind: "ride"; ride_id: string } | { kind: "code"; scan_event_id?: string; dtc_code: string };

export function ReportAction({ input, label }: { input: ReportSubject; label: (price: string) => string }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const session = useSession();
  const signedIn = MOCK_MODE || typeof session === "string";
  const [waiting, setWaiting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [report, setReport] = useState<ReportRow | null>(null);
  const targetLocale = useRef<"en" | "es">(locale);
  const startingBalance = useRef(0);
  const pricing = usePricing(waiting ? 1000 : false);
  const balance = pricing.data?.account?.balance ?? 0;
  const copy = COPY[locale];
  const state = reportButtonState({ signedIn, balance, waiting, generating, done: report != null });
  const price = formatPrice(pricing.data?.catalog.single, locale);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setPhase((value) => (value + 1) % copy.writing.length), 1800);
    return () => window.clearInterval(timer);
  }, [copy.writing.length, generating]);

  useEffect(() => {
    if (waiting && balance > startingBalance.current) {
      setWaiting(false);
      toast.success(copy.bought);
      void generate(targetLocale.current);
    }
  }, [balance, copy.bought, waiting]);

  const generate = async (language: "en" | "es") => {
    setGenerating(true);
    setPhase(0);
    try {
      const result = await billingRun((billing) => billing.generateReport({ ...input, locale: language } as GenerateReportInput));
      const row = await billingRun((billing) => billing.getReport(result.report_id));
      setReport(row);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void pricing.refetch();
    } catch (error) {
      toast.error(copy.failed, { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setGenerating(false);
    }
  };

  const begin = async (language = locale) => {
    targetLocale.current = language;
    if (!signedIn) {
      toast.info(copy.signInToast);
      return;
    }
    if (balance > 0) {
      await generate(language);
      return;
    }
    try {
      startingBalance.current = balance;
      const url = await billingRun((billing) => billing.createCheckout("single"));
      if (!MOCK_MODE) await openUrl(url);
      setWaiting(true);
    } catch (error) {
      toast.error(copy.failed, { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const buttonLabel = state === "signed_out"
    ? copy.signIn
    : state === "waiting"
      ? copy.waiting
      : state === "generating"
        ? copy.writing[phase]
        : state === "done"
          ? copy.open
          : label(price);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button className="min-h-10" disabled={generating || pricing.isPending} aria-busy={generating || undefined} onClick={() => state === "done" && report ? setReport(report) : void begin()}>
          {buttonLabel}
        </Button>
        {waiting && <Button className="min-h-10" variant="ghost" onClick={() => setWaiting(false)}>{copy.cancel}</Button>}
      </div>
      {report && <ReportView report={report} onClose={() => setReport(null)} onRegenerate={() => { setReport(null); void begin(report.locale === "en" ? "es" : "en"); }} />}
    </>
  );
}
