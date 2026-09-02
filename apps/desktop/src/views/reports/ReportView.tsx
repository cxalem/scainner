import { ArrowLeft, Printer } from "lucide-react";
import type { ReportRow } from "@scainner/core";
import { Button } from "@/components/ui/button";
import { reportSections } from "@/lib/reports";

const COPY = {
  en: { back: "Back", ride: "Ride report", code: "Code report", export: "Export PDF", readings: "Readings", channels: "Channels", events: "Events" },
  es: { back: "Volver", ride: "Informe del trayecto", code: "Informe del código", export: "Exportar PDF", readings: "Lecturas", channels: "Canales", events: "Eventos" },
} as const;

export function ReportView({ report, onClose }: { report: ReportRow; onClose: () => void }) {
  const copy = COPY[report.locale];
  const summary = report.summary;
  return (
    <section className="fixed inset-0 z-50 overflow-y-auto bg-bg text-text print:static print:overflow-visible" aria-label={report.kind === "ride" ? copy.ride : copy.code}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-divider bg-surface/95 px-6 py-3 backdrop-blur print:hidden">
        <Button variant="ghost" onClick={onClose}><ArrowLeft aria-hidden="true" />{copy.back}</Button>
        <span className="flex-1" />
        <Button onClick={() => window.print()}><Printer aria-hidden="true" />{copy.export}</Button>
      </div>
      <article className="mx-auto max-w-4xl px-6 py-10 print:max-w-none print:p-0">
        <header className="overflow-hidden rounded-lg bg-section px-8 py-9 text-section-text shadow-sm print:shadow-none">
          <p className="text-xs uppercase tracking-[0.12em] text-section-accent">Sonda · {report.kind === "ride" ? copy.ride : `${copy.code} ${report.dtc_code ?? ""}`}</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight">{new Date(report.created_at).toLocaleDateString(report.locale, { dateStyle: "long" })}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-section-muted">{summary?.verdict}</p>
        </header>
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {[[copy.readings, summary?.readings ?? 0], [copy.channels, summary?.channels ?? 0], [copy.events, summary?.events ?? 0]].map(([label, value]) => (
            <div key={label} className="rounded-md bg-accent-900 p-4"><dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt><dd className="num mt-2 text-xl text-accent-300">{value}</dd></div>
          ))}
        </dl>
        <div className="mt-8 space-y-8">
          {reportSections(report.content_md ?? "").map((section) => (
            <section key={section.title} className="border-t border-divider pt-5">
              <h2 className="text-lg font-medium">{section.title}</h2>
              <div className="mt-3 max-w-prose whitespace-pre-line text-sm leading-7 text-neutral-300">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </section>
  );
}
