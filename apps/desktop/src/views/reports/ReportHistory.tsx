import { useState } from "react";
import { FileText } from "lucide-react";
import type { ReportRow } from "@scainner/core";
import { Button, Card, CardHead, Note, Skeleton } from "@/components/ui";
import { useReports } from "@/features/reports/queries";
import { useLocale } from "@/i18n";
import { ReportView } from "./ReportView";

export function ReportHistory() {
  const { locale } = useLocale();
  const reports = useReports();
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const copy = locale === "es"
    ? { title: "Informes anteriores", empty: "Los informes que compres aparecerán aquí.", failed: "No se pudieron cargar los informes.", retry: "Reintentar", ride: "Trayecto", code: "Código" }
    : { title: "Past reports", empty: "Reports you buy will appear here.", failed: "Could not load reports.", retry: "Retry", ride: "Ride", code: "Code" };
  return (
    <>
      <Card flush>
        <CardHead icon={FileText} title={copy.title} divided />
        {reports.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          : reports.isError ? <div className="flex items-center gap-2 p-4"><Note className="text-stop">{copy.failed}</Note><Button size="sm" onClick={() => reports.refetch()}>{copy.retry}</Button></div>
          : reports.data?.length ? <div className="divide-y divide-divider">{reports.data.map((report) => (
            <button key={report.id} type="button" onClick={() => setSelected(report)} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
              <span className="font-medium">{report.kind === "ride" ? copy.ride : `${copy.code} ${report.dtc_code}`}</span>
              <span className="flex-1 truncate text-sm text-neutral-500">{report.summary?.verdict}</span>
              <span className="num text-xs text-neutral-500">{new Date(report.created_at).toLocaleDateString(locale)}</span>
            </button>
          ))}</div> : <Note className="p-4">{copy.empty}</Note>}
      </Card>
      {selected && <ReportView report={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
