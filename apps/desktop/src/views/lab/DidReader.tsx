// Read one identifier (service 22) on the selected module by hand.
import { useState } from "react";
import { Effect } from "effect";
import { runPromise } from "@/core/runtime";
import { DeviceService } from "@scainner/core";
import { Button, Card, Input, Mono } from "@/components/ui";
import type { UdsHit } from "@scainner/core";
import { useT } from "@/i18n";

export function DidReader({ module, connected }: { module: string; connected: boolean }) {
  const t = useT();
  const [did, setDid] = useState("F190");
  const [result, setResult] = useState<UdsHit | null | "nothing">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const hit = await runPromise(Effect.flatMap(DeviceService, (device) => device.udsRead(module, parseInt(did, 16))));
      setResult(hit ?? "nothing");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-[9px] px-4 py-3.5">
      <span className="text-[13px]">{t.lab.drawer.readOne}</span>
      <div className="flex items-center gap-2">
        <Mono className="text-[12.5px] text-neutral-500">22</Mono>
        <Input
          aria-label={t.lab.didReader.didAriaLabel}
          className="num text-[12.5px]"
          value={did}
          onChange={(e) => setDid(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 4))}
        />
        <Button size="sm" onClick={read} busy={busy} disabled={!connected}>
          {busy ? t.lab.didReader.reading : t.lab.didReader.read}
        </Button>
      </div>
      <Mono className="min-h-[15px] break-all text-[12px] text-neutral-400">
        {result === "nothing" ? t.lab.didReader.noAnswer : result ? `${result.hex} |${result.ascii}|` : ""}
      </Mono>
      {error && <p className="text-[12px] text-stop">{error}</p>}
    </Card>
  );
}
