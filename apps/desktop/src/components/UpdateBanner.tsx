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
import { Banner, Button, IconButton } from "@/components/ui";
import { Reveal } from "@/motion/components";
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

  return (
    <Reveal when={update != null && !dismissed} mode="fade">
      <Banner
        tone="info"
        icon={Download}
        action={
          <span className="flex items-center gap-2">
            {failed && <span className="text-[11.5px] text-stop">{t.updater.failed}</span>}
            <Button variant="secondary" size="sm" onClick={install} busy={installing}>
              {installing ? t.updater.installing : t.updater.install}
            </Button>
            <IconButton icon={X} label={t.common.close} onClick={() => setDismissed(true)} disabled={installing} />
          </span>
        }
      >
        {update ? t.updater.available(update.version) : ""}
      </Banner>
    </Reveal>
  );
}
