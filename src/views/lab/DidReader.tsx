import { useState } from "react";
import { invoke } from "@/lib/tauri";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { UdsHit } from "@/lib/meta";

const inputCls =
  "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/// Reads a single UDS data identifier (service 22) on the selected module.
export function DidReader({ module, connected }: { module: string; connected: boolean }) {
  const [did, setDid] = useState("F190");
  const [result, setResult] = useState<UdsHit | null | "nothing">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<UdsHit | null>("uds_read", { module, did: parseInt(did, 16) });
      setResult(r ?? "nothing");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Read one DID</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">22</span>
          <input
            aria-label="DID (hex)"
            className={inputCls + " w-24"}
            value={did}
            onChange={(e) => setDid(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
          />
          <Button onClick={read} disabled={!connected || busy}>
            {busy ? "Reading…" : "Read"}
          </Button>
        </div>
        {result === "nothing" && <p className="text-sm text-muted-foreground">No answer (DID not supported or refused).</p>}
        {result && result !== "nothing" && (
          <div className="rounded bg-muted p-2 font-mono text-xs">
            <div>{result.hex}</div>
            <div className="text-muted-foreground">|{result.ascii}|</div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
