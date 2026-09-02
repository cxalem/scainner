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
