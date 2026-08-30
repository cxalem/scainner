import { useState } from "react";
import { CheckCircle2, CircleDashed, History, ListChecks, Zap } from "lucide-react";
import { Button, Card, CardHead, Mono, Note, Pill, Skeleton, Table, Td, Th, Tr } from "@/components/ui";
import { Block, Reveal } from "@/motion/components";
import { monitorLabel } from "@/shared/domain/gauges";
import type { DtcResult, ObdClearOutcome } from "@scainner/core";
import { WriteHistory } from "@/components/WriteHistory";
import { useDtcHistory } from "@/features/diagnose/queries";
import { detectVoltageCluster } from "@/lib/dtc-grouping";
import { ScanConsole } from "@/views/diagnose/ScanConsole";
import { DtcDetailModal } from "@/views/diagnose/DtcDetailModal";
import { AiReportCard } from "@/views/diagnose/AiReportCard";
import { useLocale, useT } from "@/i18n";
import { formatVoltage } from "@/lib/format";

const HISTORY_ROW_CODE_LIMIT = 8;

export function Diagnose({ connected, vehicleId = null }: { connected: boolean; vehicleId?: number | null }) {
  const t = useT();
  const { locale } = useLocale();
  const [scan, setScan] = useState<DtcResult | null>(null);
  const [readiness, setReadiness] = useState<Record<string, boolean> | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);

  const historyQuery = useDtcHistory(vehicleId);
  const history = historyQuery.data ?? [];

  const handleScanSuccess = (scanResult: DtcResult, readinessResult: Record<string, boolean> | null) => {
    setScan(scanResult);
    setReadiness(readinessResult);
  };
  const handleClearSuccess = (outcome: ObdClearOutcome) => setScan(outcome.after);

  const cluster = scan ? detectVoltageCluster(scan) : null;
  const incomplete = readiness ? Object.values(readiness).filter((v) => !v).length : 0;

  return (
    <>
      <Block>
        <ScanConsole
          connected={connected}
          scan={scan}
          history={history}
          readiness={readiness}
          onScanSuccess={handleScanSuccess}
          onClearSuccess={handleClearSuccess}
        />
      </Block>

      <Reveal when={scan !== null}>
        <div className="grid grid-cols-2 gap-3">
          <Card className="gap-2.5">
            <CardHead icon={ListChecks} title={t.diagnose.v2.monitorsTitle} />
            {readiness ? (
              <>
                <div className="grid grid-cols-2 gap-[7px]">
                  {Object.entries(readiness).map(([monitor, ready]) => {
                    const Icon = ready ? CheckCircle2 : CircleDashed;
                    return (
                      <div key={monitor} className="flex items-center gap-[7px] text-[12.5px]">
                        <Icon className={ready ? "h-[13px] w-[13px] text-ok" : "h-[13px] w-[13px] text-neutral-600"} aria-hidden="true" />
                        <span className="text-neutral-300">{monitorLabel(monitor, locale)}</span>
                      </div>
                    );
                  })}
                </div>
                <Note className="text-[11.5px]">{incomplete === 0 ? t.diagnose.v2.monitorsAllNote : t.diagnose.v2.monitorsNote(incomplete)}</Note>
              </>
            ) : (
              <Note>{t.diagnose.readiness.runScanToCheck}</Note>
            )}
          </Card>
          <Card className="gap-2">
            <CardHead icon={Zap} title={t.diagnose.v2.voltageTitle} />
            {cluster ? (
              <>
                <p className="max-w-[52ch] text-[13px] leading-[1.6] text-neutral-300">{cluster.note}</p>
                <Note className="text-[11.5px]">{t.diagnose.v2.voltageHint}</Note>
              </>
            ) : (
              <Note>
                {scan?.voltage != null ? `${formatVoltage(scan.voltage, locale)} · ` : ""}
                {t.diagnose.v2.voltageHint}
              </Note>
            )}
          </Card>
        </div>
      </Reveal>

      <Reveal when={scan !== null || history.length > 0}>
        <AiReportCard hasAnyData={history.length > 0 || scan !== null} vehicleId={vehicleId} />
      </Reveal>

      <Block>
        <Card flush>
          <CardHead icon={History} title={t.diagnose.v2.history.title} divided />
          {historyQuery.isPending ? (
            <div className="flex flex-col gap-2 px-[17px] py-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : historyQuery.isError ? (
            <div className="flex items-center gap-2 px-[17px] py-3 text-[12.5px] text-stop">
              <span>{t.diagnose.scanHistory.couldNotLoad}</span>
              <Button variant="secondary" size="sm" onClick={() => historyQuery.refetch()}>
                {t.common.retry}
              </Button>
            </div>
          ) : history.length === 0 ? (
            <Note className="px-[17px] py-3">{t.diagnose.v2.history.empty}</Note>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.diagnose.v2.history.when}</Th>
                  <Th>{t.diagnose.v2.history.codes}</Th>
                  <Th align="right">{t.diagnose.v2.history.voltage}</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const codes = [...new Set([...row.stored, ...row.pending, ...row.permanent])];
                  const shown = codes.slice(0, HISTORY_ROW_CODE_LIMIT);
                  const hidden = codes.length - shown.length;
                  return (
                    <Tr key={row.id}>
                      <Td>
                        <Mono className="text-[11.5px] text-neutral-500">{row.ts} UTC</Mono>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {codes.length === 0 ? (
                            <Pill variant="ok">{t.diagnose.scanHistory.clean}</Pill>
                          ) : (
                            <>
                              {shown.map((code) => (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => setDetailCode(code)}
                                  aria-label={t.diagnose.detailsFor(code)}
                                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  <Pill variant={row.pending.includes(code) && !row.stored.includes(code) ? "info" : "warn"} className="num cursor-pointer hover:underline">
                                    {code}
                                  </Pill>
                                </button>
                              ))}
                              {hidden > 0 && <Pill variant="standard">{t.diagnose.historyMore(hidden)}</Pill>}
                            </>
                          )}
                        </span>
                      </Td>
                      <Td align="right">
                        <Mono className="text-neutral-500">{row.voltage != null ? formatVoltage(row.voltage, locale) : "—"}</Mono>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </Block>

      <Block>
        <WriteHistory vehicleId={vehicleId} />
      </Block>

      {detailCode && (
        <DtcDetailModal code={detailCode} history={history} scan={scan} vehicleId={vehicleId} onClose={() => setDetailCode(null)} />
      )}
    </>
  );
}
