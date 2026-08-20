import { useEffect, useState } from "react";
import { invoke } from "@/lib/tauri";
import { Bot, Car, Copy, Database, RefreshCw } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { EcuInfo } from "@/lib/meta";

export function Vehicle({ connected }: { connected: boolean }) {
  const [info, setInfo] = useState<Record<string, string>>({});
  const [dbPath, setDbPath] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const load = () =>
    invoke<[string, string][]>("car_info")
      .then((rows) => setInfo(Object.fromEntries(rows)))
      .catch(() => {});
  useEffect(() => {
    load();
    invoke<string>("db_path").then(setDbPath).catch(() => {});
  }, []);

  const readEcu = async () => {
    try {
      await invoke<EcuInfo>("read_ecu_info");
      load();
    } catch {
      // surfaced via conn state; nothing to show here
    }
  };

  const copyExport = async (hours: number, label: string) => {
    const json = await invoke<string>("export_json", { sinceHours: hours });
    await navigator.clipboard.writeText(json);
    setCopied(label);
    setTimeout(() => setCopied(null), 2500);
  };

  const copyBriefing = async () => {
    const md = await invoke<string>("ai_context", { sinceHours: 24 * 30 });
    await navigator.clipboard.writeText(md);
    setCopied("ai");
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Vehicle</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Car className="h-4 w-4" aria-hidden="true" /> Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {Object.keys(info).length === 0 ? (
            <p className="text-muted-foreground">Nothing read yet — connect and read the ECU.</p>
          ) : (
            Object.entries(info).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-28 text-muted-foreground">{k}</span>
                <span className="font-mono">{v}</span>
              </div>
            ))
          )}
          <div>
            <Button variant="outline" onClick={readEcu} disabled={!connected}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Read from ECU
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Database className="h-4 w-4" aria-hidden="true" /> Data
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Everything is stored locally in SQLite. Point any tool (or an AI session) at:
          </p>
          <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{dbPath}</code>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copyBriefing}>
              <Bot className="h-4 w-4" aria-hidden="true" />
              {copied === "ai" ? "Copied — paste it to any AI" : "Copy AI briefing"}
            </Button>
            <Button variant="outline" onClick={() => copyExport(24, "24h")}>
              <Copy className="h-4 w-4" aria-hidden="true" /> {copied === "24h" ? "Copied" : "Raw JSON, 24h"}
            </Button>
            <Button variant="outline" onClick={() => copyExport(24 * 30, "30d")}>
              <Copy className="h-4 w-4" aria-hidden="true" /> {copied === "30d" ? "Copied" : "Raw JSON, 30d"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The AI briefing is a readable markdown summary — car identity, recent scans with freeze frames, and
            sensor stats — sized to paste straight into a chat.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
