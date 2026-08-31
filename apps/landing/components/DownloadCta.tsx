"use client";

// Ported from the design's own Component logic (Sonda Landing.dc.html's
// <script data-dc-script>): detect the visitor's platform, show a direct
// download for macOS (the only platform that ships today) or a waitlist
// form for everything else. Client component — needs navigator/window,
// and the waitlist form is local interactive state only (no backend wired
// yet; wire onJoin to a real endpoint when one exists).
//
// Every color here is a --section-* token (app/tokens.css) via its Tailwind
// name, never a raw hex/rgba — this component only ever renders on the
// dark ground (hero, footer), so it exclusively uses that token family.
//
// All copy comes from the `dict` prop (lib/i18n) — nothing here is
// hardcoded to English, since the same components render on both / and
// /es/.
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { formatTemplate } from "@/lib/i18n/format";
import { AndroidIcon, AppleIcon, BellIcon, CheckCircleIcon, DesktopIcon, DownloadIcon, MobileIcon, PlugIcon, WindowsIcon } from "./Icon";

type Platform = "mac" | "windows" | "ios" | "android" | "other";
type PlatformIcon = ComponentType<{ size?: number; className?: string }>;

const PLATFORM_ICONS: Record<Platform, PlatformIcon> = {
  mac: AppleIcon,
  windows: WindowsIcon,
  ios: MobileIcon,
  android: AndroidIcon,
  other: DesktopIcon,
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const ua = navigator.userAgent || "";
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const plat = uaData?.platform || navigator.platform || "";
  const touch = navigator.maxTouchPoints > 1;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPod/i.test(ua)) return "ios";
  if (/iPad/i.test(ua) || (/Macintosh/.test(ua) && touch)) return "ios";
  if (/Win/i.test(plat) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(plat) || /Mac OS X/i.test(ua)) return "mac";
  return "other";
}

export function useDetectedPlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectPlatform()), []);
  return platform;
}

// The one recurring CTA look on the dark ground — its own named --section-
// chip-* tokens (already in the app's tokens.css for exactly this "glass
// button" role), not a one-off style.
const DARK_CHIP_BTN =
  "border-section-chip-border bg-section-chip-bg text-section-chip-text hover:bg-section-chip-bg-hover hover:border-section-chip-border-hover";

/** The nav bar's compact CTA — text only, no form, matches the design's
 *  navCta binding ("Download" vs "Get notified"). */
export function NavCta({ dict }: { dict: Dictionary }) {
  const platform = useDetectedPlatform();
  const isMac = platform === null || platform === "mac";
  return (
    <Button asChild variant="outline" size="default" className={`h-auto gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-[13.5px] font-medium ${DARK_CHIP_BTN}`}>
      <a href="#get">
        <DownloadIcon size={15} />
        {isMac ? dict.nav.download : dict.nav.getNotified}
      </a>
    </Button>
  );
}

export function HeroCta({ dict }: { dict: Dictionary }) {
  const platform = useDetectedPlatform();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  // Avoid a hydration mismatch: render nothing platform-specific until the
  // client effect resolves, then show the real branch.
  if (platform === null) return <div className="h-[92px]" aria-hidden="true" />;

  if (platform === "mac") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Button
          asChild
          className={`h-auto gap-2.5 rounded-[var(--radius-md)] px-6 py-3.5 text-base font-medium transition-all hover:shadow-[0_0_32px_-6px_var(--section-glow)] ${DARK_CHIP_BTN}`}
        >
          <a href="#">
            <AppleIcon size={18} />
            {dict.hero.downloadMac}
          </a>
        </Button>
        <div className="flex items-center gap-2 text-[13px] text-section-subtle">
          <PlugIcon size={15} />
          {dict.hero.worksWithAdapter}
        </div>
      </div>
    );
  }

  const platformName = dict.platforms[platform];
  const Icon = PLATFORM_ICONS[platform];
  return (
    <div className="flex max-w-[430px] flex-col gap-3">
      <div className="flex items-center gap-2 text-[14.5px] text-section-text">
        <Icon size={17} className="text-section-accent" />
        <span>{formatTemplate(dict.hero.comingSoon, { platform: platformName })}</span>
      </div>
      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
          className="flex flex-wrap gap-2"
        >
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={dict.hero.emailPlaceholder}
            className="h-auto min-w-[200px] flex-1 rounded-[var(--radius-sm)] border-section-divider bg-section-input-bg px-4 py-3 text-[15px] text-section-headline placeholder:text-section-faintest focus-visible:border-section-accent focus-visible:ring-0"
          />
          <Button type="submit" className={`h-auto rounded-[var(--radius-sm)] px-5 py-3 text-[15px] font-medium ${DARK_CHIP_BTN}`}>
            {dict.hero.notifyMe}
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-section-divider-strong bg-section-chip-bg px-4 py-3.5 text-[14.5px] text-section-text">
          <CheckCircleIcon size={18} className="text-section-accent" />
          {dict.hero.onTheList}
        </div>
      )}
      {!sent && (
        <div className="text-[13px] text-section-subtle">{formatTemplate(dict.hero.oneEmail, { platform: platformName })}</div>
      )}
      <a href="#" className="self-start text-[13.5px] text-section-accent hover:text-section-accent-strong">
        {dict.hero.orDownloadMac}
      </a>
    </div>
  );
}

export function FooterCta({ dict }: { dict: Dictionary }) {
  const platform = useDetectedPlatform();
  const isMac = platform === null || platform === "mac";
  const platformName = dict.platforms[platform ?? "mac"];
  return (
    <Button
      asChild
      variant="outline"
      className="mt-5 h-auto gap-2.5 rounded-[var(--radius-md)] border-accent-400 px-7 py-3.5 text-base font-medium text-accent-400 hover:bg-accent-200"
    >
      <a href="#get">
        {isMac ? <AppleIcon size={19} /> : <BellIcon size={19} />}
        {isMac ? dict.pricing.downloadMac : formatTemplate(dict.pricing.notifyMe, { platform: platformName })}
      </a>
    </Button>
  );
}
