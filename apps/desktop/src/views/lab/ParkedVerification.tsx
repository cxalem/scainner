import { useState } from "react";
import { CheckCircle2, CircleAlert, FlaskConical, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { invoke } from "@/lib/tauri";

type Outcome = {
  status: "answered" | "refused" | "timed_out" | "transport_failed" | "malformed";
  nrc: number | null;
  detail: string | null;
};

type Report = {
  run_id: number | null;
  plan_version: string;
  safety: string;
  targets: Array<{
    key: string;
    label: string;
    expected_family: string;
    route: string;
    evidence_source: string;
    summary: string | null;
    observations: Array<{
      did: string;
      purpose: string;
      outcome: Outcome;
      payload_hex: string | null;
      printable: string | null;
      raw_response: string | null;
    }>;
  }>;
};

const outcomeLabel = (outcome: Outcome) => {
  if (outcome.status === "refused" && outcome.nrc != null) {
    return `refused · NRC ${outcome.nrc.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return outcome.status.replace(/_/g, " ");
};

export function ParkedVerification({ connected, vehicleId }: { connected: boolean; vehicleId: number | null }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await invoke<Report>("parked_verification"));
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4" aria-hidden="true" /> Parked vehicle verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border bg-muted/35 p-3 text-sm">
          <p className="font-medium">Before starting</p>
          <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
            <li>Park safely, apply the parking brake, and switch the ignition on.</li>
            <li>The engine may idle. Leave lights, wipers, climate, and parking controls untouched during this baseline pass.</li>
            <li>Keep the adapter connected until every target has a result. The ABS data sweep reads 768 identifiers and takes a few minutes.</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Read-only: default session and service 22 only. No actuator commands, routines, clearing, or writes.
          </p>
        </div>

        <Button onClick={run} disabled={!connected || vehicleId == null || running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="h-4 w-4" aria-hidden="true" />}
          {running ? "Testing candidates…" : "Run verification"}
        </Button>
        {!connected && <p className="text-xs text-muted-foreground">Connect to the car to run this test.</p>}
        {connected && vehicleId == null && <p className="text-xs text-muted-foreground">Name the connected vehicle first so evidence is stored against the right car.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Saved as evidence run #{report.run_id ?? "—"} · {report.plan_version}
            </div>
            {report.targets.map((target) => {
              const answered = target.observations.filter((item) => item.outcome.status === "answered").length;
              return (
                <details key={target.key} className="rounded-md border border-border p-3" open={answered > 0}>
                  <summary className="cursor-pointer list-none">
                    <span className="font-medium">{target.label}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{target.route}</span>{" "}
                    <Badge variant={answered > 0 ? "ok" : "muted"}>{answered}/{target.observations.length} answered</Badge>
                    <p className="mt-1 text-xs text-muted-foreground">Expected: {target.expected_family} · candidate until verified here</p>
                    {target.summary && <p className="mt-1 text-xs text-muted-foreground">{target.summary}</p>}
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="text-muted-foreground"><th className="pb-1">DID</th><th>Purpose</th><th>Result</th><th>Evidence</th></tr></thead>
                      <tbody>
                        {target.observations.map((item) => (
                          <tr key={item.did} className="border-t border-border align-top">
                            <td className="py-1.5 pr-3 font-mono">{item.did}</td>
                            <td className="py-1.5 pr-3">{item.purpose}</td>
                            <td className="py-1.5 pr-3">
                              <span className="inline-flex items-center gap-1">
                                {item.outcome.status === "answered" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <CircleAlert className="h-3 w-3 text-muted-foreground" />}
                                {outcomeLabel(item.outcome)}
                              </span>
                            </td>
                            <td className="max-w-80 break-all py-1.5 font-mono" title={item.raw_response ?? item.payload_hex ?? item.outcome.detail ?? undefined}>
                              {item.printable ?? item.payload_hex ?? item.raw_response?.trim() ?? item.outcome.detail ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
