// product-plan.md's 2026-08-21 decision: Tauri's built-in updater over
// GitHub Releases, checked silently, never blocking, never surfaced as an
// error if it fails. This banner is the one visible piece of that: it
// mounts once (in Shell.tsx, above every view) and stays invisible unless
// a real update is actually found.
//
// The check itself happens outside a browser preview (MOCK_MODE) — there
// is no Tauri runtime to ask, and no reason to fake one — and is wrapped
// in a bare try/catch with no fallback UI: offline, GitHub unreachable, a
// malformed manifest, anything at all, all collapse to "no update found",
// same as genuinely being up to date. The one place an error DOES surface
// is install itself (downloadAndInstall/relaunch), because by then the
// user asked for it and silently doing nothing would look broken.
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui";
import { MOCK_MODE } from "@/lib/tauri";
import { useT } from "@/i18n";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (MOCK_MODE) return;
    let cancelled = false;
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((found) => {
        if (!cancelled && found?.available) setUpdate(found);
      })
      .catch(() => {
        // Deliberately silent — see file header.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async () => {
    if (!update) return;
    setInstalling(true);
    setFailed(false);
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setInstalling(false);
      setFailed(true);
    }
  };

  if (!update || dismissed) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
      <Download className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">{t.updater.available(update.version)}</span>
      {failed && <span className="text-xs text-destructive">{t.updater.failed}</span>}
      <Button variant="outline" onClick={install} disabled={installing}>
        {installing ? t.updater.installing : t.updater.install}
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t.common.close}
        disabled={installing}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
