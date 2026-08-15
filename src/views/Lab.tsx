import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { hex4, type UdsHit, type UdsModule, type UdsProbe } from "@/lib/meta";

// Must match the backend's per-call cap in uds_scan_range (currently 256).
const SCAN_CHUNK = 256;

export function Lab({ connected }: { connected: boolean }) {
  const [modules, setModules] = useState<UdsModule[]>([]);
  const [mod, setMod] = useState("engine");
  const [did, setDid] = useState("F190");
  const [readResult, setReadResult] = useState<UdsHit | null | "nothing">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanFrom, setScanFrom] = useState("D000");
  const [scanTo, setScanTo] = useState("D3FF");
  const [hits, setHits] = useState<UdsHit[]>([]);
  const [scanProgress, setScanProgress] = useState<string | null>(null);
  const [probes, setProbes] = useState<UdsProbe[]>([]);
  const [probeDraft, setProbeDraft] = useState<Partial<UdsProbe> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [moduleFaults, setModuleFaults] = useState<string[] | null>(null);
  const [clearOutcome, setClearOutcome] = useState<{ before: string[]; accepted: boolean; after: string[] } | null>(
    null
  );
  const [liveProgress, setLiveProgress] = useState<{ current: number; total: number; did: string; hits: number } | null>(
    null
  );
  const [addingModule, setAddingModule] = useState(false);
  const [moduleDraft, setModuleDraft] = useState({ key: "", label: "", req: "", resp: "" });
  const [moduleError, setModuleError] = useState<string | null>(null);

  const loadModules = () => invoke<UdsModule[]>("uds_modules").then(setModules).catch(() => {});
  const loadProbes = () => invoke<UdsProbe[]>("list_probes").then(setProbes).catch(() => {});
  useEffect(() => {
    const un = listen<{ current: number; total: number; did: string; hits: number }>("uds-scan-progress", (e) =>
      setLiveProgress(e.payload)
    );
    return () => {
      un.then((f) => f());
    };
  }, []);
  useEffect(() => {
    loadModules();
    loadProbes();
  }, []);

  const saveModule = async () => {
    setModuleError(null);
    const { key, label, req, resp } = moduleDraft;
    if (!key || !label || !req || !resp) return;
    try {
      await invoke("add_uds_module", { key: key.toLowerCase().replace(/\s+/g, "_"), label, req, resp });
      setModuleDraft({ key: "", label: "", req: "", resp: "" });
      setAddingModule(false);
      await loadModules();
      setMod(key.toLowerCase().replace(/\s+/g, "_"));
    } catch (e) {
      setModuleError(String(e));
    }
  };

  const removeModule = async (key: string) => {
    await invoke("delete_uds_module", { key });
    await loadModules();
    if (mod === key) setMod("engine");
  };

  const doRead = async () => {
    setBusy("read");
    setError(null);
    try {
      const r = await invoke<UdsHit | null>("uds_read", { module: mod, did: parseInt(did, 16) });
      setReadResult(r ?? "nothing");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const doScan = async () => {
    setBusy("scan");
    setError(null);
    setHits([]);
    setScanProgress(null);
    setLiveProgress(null);
    try {
      const from = parseInt(scanFrom, 16);
      const to = parseInt(scanTo, 16);
      const all: UdsHit[] = [];
      for (let start = from; start <= to; start += SCAN_CHUNK) {
        const end = Math.min(start + SCAN_CHUNK - 1, to);
        setScanProgress(`scanning ${hex4(start)}–${hex4(end)}… (${all.length} hits so far)`);
        const chunk = await invoke<UdsHit[]>("uds_scan", { module: mod, from: start, to: end });
        all.push(...chunk);
        setHits([...all]);
      }
      setScanProgress(
        `done — ${all.length} DIDs answered. Heads-up: scans can leave temporary "lost communication" warnings on the dashboard; an ignition cycle clears them (see Module faults below).`
      );
    } catch (e) {
      setScanProgress(String(e));
      setError(String(e).startsWith("cancelled") ? null : String(e));
    } finally {
      setBusy(null);
      setLiveProgress(null);
    }
  };

  const doCancelScan = () => invoke("uds_cancel_scan");

  const readModuleFaults = async () => {
    setBusy("faults");
    setError(null);
    setClearOutcome(null);
    try {
      setModuleFaults(await invoke<string[]>("uds_module_dtcs", { module: mod }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const doClear = async () => {
    setConfirmClear(false);
    setBusy("clear");
    setError(null);
    setClearOutcome(null);
    try {
      const outcome = await invoke<{ before: string[]; accepted: boolean; after: string[] }>("uds_clear", {
        module: mod,
      });
      setClearOutcome(outcome);
      setModuleFaults(outcome.after);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveProbe = async () => {
    if (!probeDraft?.label) return;
    await invoke("add_probe", {
      probe: {
        id: 0,
        module: mod,
        did: probeDraft.did ?? 0,
        label: probeDraft.label,
        unit: probeDraft.unit ?? "",
        offset: probeDraft.offset ?? 0,
        len: probeDraft.len ?? 1,
        scale: probeDraft.scale ?? 1,
        bias: probeDraft.bias ?? 0,
        enabled: true,
      },
    });
    setProbeDraft(null);
    loadProbes();
  };

  const inputCls =
    "h-9 rounded-md border border-border bg-card px-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Lab</h1>
        <div className="flex items-center gap-2">
          <select
            aria-label="Module"
            className={inputCls}
            value={mod}
            onChange={(e) => setMod(e.target.value)}
          >
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.req}→{m.resp}){m.builtin ? "" : " · custom"}
              </option>
            ))}
          </select>
          {!modules.find((m) => m.key === mod)?.builtin && modules.length > 0 && (
            <button
              className="rounded text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              onClick={() => removeModule(mod)}
            >
              remove
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Manufacturer-specific reads (UDS service 22) to modules beyond standard OBD. Read-only — nothing here can
        change the car. Identified values become recorded probes. The four built-in modules use PSA/Citroën/Peugeot
        addresses — on any other brand, add your own module below with your ECU's CAN IDs.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Modules</span>
            {!addingModule && (
              <Button variant="outline" onClick={() => setAddingModule(true)}>
                Add module
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1 text-sm">
            {modules.map((m) => (
              <li key={m.key} className="flex items-center justify-between border-b border-border/50 py-1 last:border-0">
                <span>
                  {m.label} <span className="font-mono text-xs text-muted-foreground">{m.req}→{m.resp}</span>
                </span>
                <span className="text-xs text-muted-foreground">{m.builtin ? "built-in" : "custom"}</span>
              </li>
            ))}
          </ul>
          {addingModule && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Find your car's UDS request/response CAN IDs (car-hacking forums, community projects for your
                brand — see the README) and add them here. Same read-only rules apply.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Name
                  <input
                    className={inputCls + " w-40 text-foreground"}
                    placeholder="e.g. TCM"
                    value={moduleDraft.label}
                    onChange={(e) => setModuleDraft({ ...moduleDraft, label: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Key (unique)
                  <input
                    className={inputCls + " w-28 text-foreground"}
                    placeholder="tcm"
                    value={moduleDraft.key}
                    onChange={(e) => setModuleDraft({ ...moduleDraft, key: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Request CAN ID (hex)
                  <input
                    className={inputCls + " w-24 text-foreground"}
                    placeholder="7E0"
                    value={moduleDraft.req}
                    onChange={(e) => setModuleDraft({ ...moduleDraft, req: e.target.value.toUpperCase() })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Response CAN ID (hex)
                  <input
                    className={inputCls + " w-24 text-foreground"}
                    placeholder="7E8"
                    value={moduleDraft.resp}
                    onChange={(e) => setModuleDraft({ ...moduleDraft, resp: e.target.value.toUpperCase() })}
                  />
                </label>
                <Button
                  onClick={saveModule}
                  disabled={!moduleDraft.key || !moduleDraft.label || !moduleDraft.req || !moduleDraft.resp}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setAddingModule(false)}>
                  Cancel
                </Button>
              </div>
              {moduleError && <p className="text-xs text-destructive">{moduleError}</p>}
            </div>
          )}
        </CardContent>
      </Card>

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
            <Button onClick={doRead} disabled={!connected || busy !== null}>
              {busy === "read" ? "Reading…" : "Read"}
            </Button>
          </div>
          {readResult === "nothing" && (
            <p className="text-sm text-muted-foreground">No answer (DID not supported or refused).</p>
          )}
          {readResult && readResult !== "nothing" && (
            <div className="rounded bg-muted p-2 font-mono text-xs">
              <div>{readResult.hex}</div>
              <div className="text-muted-foreground">|{readResult.ascii}|</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scan a DID range</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="From DID (hex)"
              className={inputCls + " w-24"}
              value={scanFrom}
              onChange={(e) => setScanFrom(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              aria-label="To DID (hex)"
              className={inputCls + " w-24"}
              value={scanTo}
              onChange={(e) => setScanTo(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
            />
            <Button onClick={doScan} disabled={!connected || busy !== null}>
              {busy === "scan" ? (liveProgress ? `Scanning… (${liveProgress.hits} found)` : "Scanning…") : "Scan"}
            </Button>
            {busy === "scan" && (
              <Button variant="outline" onClick={doCancelScan}>
                Cancel
              </Button>
            )}
            {!liveProgress && scanProgress && <span className="text-xs text-muted-foreground">{scanProgress}</span>}
          </div>
          {liveProgress && (
            <div className="flex flex-col gap-1">
              <div
                role="progressbar"
                aria-valuenow={liveProgress.current}
                aria-valuemax={liveProgress.total}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, (liveProgress.current / Math.max(1, liveProgress.total)) * 100)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                checking {liveProgress.did}… {liveProgress.current}/{liveProgress.total} in this chunk
                {liveProgress.current > 0 && liveProgress.hits === 0
                  ? " — no answers yet; some modules stay silent for a whole range, that's normal"
                  : ""}
              </span>
            </div>
          )}
          {hits.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.did} className="border-b border-border/50 font-mono last:border-0">
                      <td className="px-2 py-1 text-muted-foreground">{hex4(h.did)}</td>
                      <td className="break-all px-2 py-1">{h.hex}</td>
                      <td className="px-2 py-1 text-muted-foreground">|{h.ascii}|</td>
                      <td className="px-2 py-1">
                        <button
                          className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => setProbeDraft({ did: h.did, len: 1, offset: 0, scale: 1, bias: 0 })}
                        >
                          → probe
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {probeDraft && (
        <Card>
          <CardHeader>
            <CardTitle>
              New probe from DID {hex4(probeDraft.did ?? 0)} on {mod}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-sm">
            {(
              [
                ["label", "text"],
                ["unit", "text"],
                ["offset", "number"],
                ["len", "number"],
                ["scale", "number"],
                ["bias", "number"],
              ] as const
            ).map(([field, type]) => (
              <label key={field} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {field}
                <input
                  className={inputCls + " w-24 text-foreground"}
                  type={type}
                  step="any"
                  value={((probeDraft as Record<string, unknown>)[field] as string | number | undefined) ?? ""}
                  onChange={(e) =>
                    setProbeDraft({
                      ...probeDraft,
                      [field]: type === "number" ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <Button onClick={saveProbe} disabled={!probeDraft.label}>
              Save probe
            </Button>
            <Button variant="ghost" onClick={() => setProbeDraft(null)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recorded probes (polled every ~30 s while connected)</CardTitle>
        </CardHeader>
        <CardContent>
          {probes.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet — scan, find something interesting, make it a probe.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {probes.map((p) => (
                <li key={p.id} className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-0">
                  <span>
                    <span className="font-medium">{p.label}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.module}/22{hex4(p.did)} [{p.offset}..{p.offset + p.len}] ×{p.scale}+{p.bias} {p.unit}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      className="rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => invoke("toggle_probe", { id: p.id, enabled: !p.enabled }).then(loadProbes)}
                    >
                      {p.enabled ? "disable" : "enable"}
                    </button>
                    <button
                      className="rounded text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      onClick={() => invoke("delete_probe", { id: p.id }).then(loadProbes)}
                    >
                      delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Module faults</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Faults stored on the selected module itself. Codes starting with <span className="font-mono">U</span> are
            communication faults — scans routinely leave these behind (the module goes quiet while answering us, and
            its neighbours log "lost contact"). They are harmless and expected.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={readModuleFaults} disabled={!connected || busy !== null}>
              <RefreshCw className={"h-4 w-4" + (busy === "faults" ? " animate-spin" : "")} aria-hidden="true" />
              {busy === "faults" ? "Reading…" : "Read faults"}
            </Button>
            {moduleFaults && moduleFaults.length > 0 && !confirmClear && (
              <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={busy !== null}>
                Clear {moduleFaults.length} fault{moduleFaults.length === 1 ? "" : "s"}…
              </Button>
            )}
          </div>

          {moduleFaults && !clearOutcome && (
            <div className="text-sm">
              {moduleFaults.length === 0 ? (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  No faults stored on this module.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {moduleFaults.map((c) => (
                    <span key={c} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {confirmClear && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span>Erase all stored codes on this module? The app verifies the result afterwards.</span>
              <Button variant="destructive" onClick={doClear} disabled={busy !== null}>
                {busy === "clear" ? "Clearing…" : "Yes, clear"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          )}

          {clearOutcome && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                {clearOutcome.after.length === 0 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    Cleared and verified — {clearOutcome.before.length || "no"} fault
                    {clearOutcome.before.length === 1 ? "" : "s"} before, none remaining.
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-warn" aria-hidden="true" />
                    Cleared {clearOutcome.before.length}, but {clearOutcome.after.length} came straight back — those
                    are active faults, not leftovers. Worth investigating.
                  </>
                )}
              </p>
              {clearOutcome.before.length > 0 && (
                <p className="font-mono text-xs text-muted-foreground">was: {clearOutcome.before.join(", ")}</p>
              )}
              {clearOutcome.after.length > 0 && (
                <p className="font-mono text-xs text-muted-foreground">still: {clearOutcome.after.join(", ")}</p>
              )}
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                If a dashboard light is still on: it lives on modules this dongle can't reach (BSI/cluster) and
                clears by itself after an ignition cycle — engine off, wait a minute, start again. No further action
                needed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
