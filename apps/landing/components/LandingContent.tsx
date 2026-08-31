import Image from "next/image";
import { EmblemScene } from "@/components/EmblemScene";
import { Wordmark } from "@/components/Brand";
import { HeroCta, NavCta, FooterCta } from "@/components/DownloadCta";
import { LocaleSwitchLink } from "@/components/LocaleSwitchLink";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/detect";
import {
  CheckIcon,
  DownloadIcon,
  EraserIcon,
  FileDownIcon,
  FileTextIcon,
  MinusIcon,
  PlusIcon,
  PulseIcon,
  SearchListIcon,
  SparkleIcon,
} from "@/components/Icon";

// Icons aren't translated content, so they stay a parallel array zipped to
// dict.showcase.features/howItWorks.steps by index rather than living in
// the dictionary itself.
const FEATURE_ICONS = [SearchListIcon, EraserIcon, PulseIcon, FileDownIcon];
const CAUSE_BAR_CLASSES = ["bg-accent-400", "bg-accent-600", "bg-neutral-700"];

export function LandingContent({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const otherLocale: Locale = locale === "en" ? "es" : "en";
  const otherLocaleHref = locale === "en" ? "/es/" : "/";

  return (
    <div className="flex min-h-screen flex-col">
      {/* ————————————————————————— Header / hero ————————————————————————— */}
      <header className="relative overflow-hidden bg-section">
        <div className="sn-glow pointer-events-none absolute inset-0 bg-[radial-gradient(64%_58%_at_72%_24%,var(--section-glow),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--section-divider)_18%,var(--section-divider)_82%,transparent)]" />

        <nav className="relative mx-auto flex max-w-[1140px] items-center justify-between gap-6 px-5 py-5 sm:px-8">
          <Wordmark size={26} tone="color" textClassName="text-[19px] text-section-text" />
          <NavCta dict={dict} />
        </nav>

        <div className="relative mx-auto grid max-w-[1140px] grid-cols-1 items-center gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12 lg:pb-[82px] lg:pt-8">
          <div className="sn-rise flex flex-col gap-6">
            <div className="flex items-center gap-2.5 text-[13px] text-section-accent sm:text-[14px]">
              <span className="h-px w-6 shrink-0 bg-section-accent" />
              {dict.hero.eyebrow}
            </div>
            <h1 className="max-w-[15ch] text-[38px] font-medium leading-[1.06] tracking-[-0.02em] text-section-headline sm:text-[48px] lg:text-[60px] lg:leading-[1.04] lg:tracking-[-0.025em]">
              {dict.hero.heading}
            </h1>
            <p className="max-w-[44ch] text-[16px] leading-[1.62] text-section-muted sm:text-[17px]">{dict.hero.body}</p>
            <div id="get" className="flex flex-col gap-3.5 pt-1.5">
              <HeroCta dict={dict} />
            </div>
          </div>

          <div className="sn-fade relative h-[300px] sm:h-[360px] lg:h-[420px]">
            <EmblemScene className="h-full w-full" />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ————————————————————————— App showcase ————————————————————————— */}
        <section className="mx-auto max-w-[1140px] px-5 pb-6 pt-16 sm:px-8 sm:pt-20 lg:pt-[88px]">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-6 lg:mb-8">
            <h2 className="max-w-[22ch] text-[28px] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[34px] lg:text-[38px] lg:leading-[1.1]">
              {dict.showcase.heading}
            </h2>
            <p className="max-w-[34ch] text-[15px] leading-[1.6] text-neutral-400 sm:text-[15.5px]">{dict.showcase.body}</p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-divider bg-accent-900 p-3 shadow-lg">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-md)] bg-surface">
              <Image
                src="/screenshots/overview.png"
                alt={dict.showcase.screenshotAlt}
                fill
                sizes="(max-width: 1140px) 100vw, 1140px"
                priority
                className="object-cover object-top"
              />
            </div>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:mt-[34px] lg:grid-cols-4">
            {dict.showcase.features.map(({ title, body }, i) => {
              const Icon = FEATURE_ICONS[i]!;
              return (
                <div key={title} className="flex flex-col gap-2.5">
                  <Icon size={20} className="text-accent-400" />
                  <div className="text-[14.5px] font-medium">{title}</div>
                  <p className="m-0 text-[13.5px] leading-[1.6] text-neutral-400">{body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ————————————————————————— How it works ————————————————————————— */}
        <section className="mx-auto max-w-[1140px] px-5 pb-5 pt-20 sm:px-8 lg:pt-[92px]">
          <div className="mb-4 text-[13px] uppercase tracking-[0.1em] text-neutral-500">{dict.howItWorks.kicker}</div>
          <h2 className="mb-9 max-w-[20ch] text-[28px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[34px] lg:mb-11 lg:text-[38px] lg:leading-[1.12]">
            {dict.howItWorks.heading}
          </h2>
          <div className="grid grid-cols-1 gap-7 md:grid-cols-3">
            {dict.howItWorks.steps.map(({ title, body }, i) => (
              <div key={title} className="flex flex-col gap-3 border-t border-divider pt-5">
                <div className="font-mono text-[12px] text-accent-400">{String(i + 1).padStart(2, "0")}</div>
                <div className="text-[18px] font-medium sm:text-[19px]">{title}</div>
                <p className="m-0 text-[14px] leading-[1.65] text-neutral-400 sm:text-[14.5px]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ————————————————————————— Any connector ————————————————————————— */}
        <section className="mx-auto max-w-[1140px] px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <div className="flex flex-col gap-4">
              <div className="text-[13px] uppercase tracking-[0.1em] text-neutral-500">{dict.connectors.kicker}</div>
              <h2 className="max-w-[20ch] text-[26px] font-medium leading-[1.16] tracking-[-0.02em] sm:text-[30px] lg:text-[34px] lg:leading-[1.14]">
                {dict.connectors.heading}
              </h2>
              <p className="max-w-[44ch] text-[15px] leading-[1.66] text-neutral-400 sm:text-[15.5px]">{dict.connectors.body}</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {dict.connectors.list.map((c) => (
                <Badge
                  key={c}
                  variant="outline"
                  className="h-auto rounded-full border-divider bg-surface px-3.5 py-2 text-[14px] font-normal text-neutral-300 shadow-sm"
                >
                  {c}
                </Badge>
              ))}
              <Badge
                variant="outline"
                className="h-auto rounded-full border-accent-700 bg-accent-900 px-3.5 py-2 text-[14px] font-normal text-accent-400 shadow-sm"
              >
                {dict.connectors.brandsRecognised}
              </Badge>
            </div>
          </div>
        </section>

        {/* ————————————————————————— Same fault, two answers ————————————————————————— */}
        <section className="border-y border-divider bg-accent-900">
          <div className="mx-auto max-w-[1140px] px-5 py-16 sm:px-8 lg:py-[92px]">
            <div className="mb-4 text-[13px] uppercase tracking-[0.1em] text-neutral-500">{dict.comparison.kicker}</div>
            <div className="mb-9 flex flex-wrap items-end justify-between gap-6 lg:mb-10">
              <h2 className="max-w-[18ch] text-[28px] font-medium leading-[1.12] tracking-[-0.02em] sm:text-[34px] lg:text-[38px] lg:leading-[1.1]">
                {dict.comparison.heading}
              </h2>
              <p className="max-w-[40ch] text-[15px] leading-[1.6] text-neutral-400 sm:text-[15.5px]">{dict.comparison.body}</p>
            </div>

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
              {/* generic reader */}
              <Card className="rounded-[var(--radius-md)] border-divider bg-transparent p-0 shadow-none ring-0">
                <CardContent className="flex flex-col gap-5 p-6">
                  <span className="text-[11.5px] uppercase tracking-[0.09em] text-neutral-500">{dict.comparison.genericReader.label}</span>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-[30px] font-semibold tracking-[-0.02em] text-neutral-400 sm:text-[34px]">
                      {dict.comparison.genericReader.code}
                    </span>
                    <span className="text-[14.5px] text-neutral-400">{dict.comparison.genericReader.title}</span>
                  </div>
                  <div className="flex flex-col gap-2.5 border-t border-divider pt-4.5">
                    {dict.comparison.genericReader.rows.map((row) => (
                      <div key={row} className="flex items-center gap-2.5 text-[14px] text-neutral-600">
                        <MinusIcon size={14} />
                        {row}
                      </div>
                    ))}
                  </div>
                  <span className="text-[13.5px] leading-[1.55] text-neutral-500">{dict.comparison.genericReader.footer}</span>
                </CardContent>
              </Card>

              {/* Sonda report */}
              <Card className="overflow-hidden rounded-[var(--radius-md)] border-accent-700 bg-surface p-0 shadow-md ring-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider p-4.5 sm:p-5.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[11.5px] uppercase tracking-[0.09em] text-accent-400">Sonda</span>
                    <span className="font-mono text-[14px] font-semibold">{dict.comparison.sonda.code}</span>
                    <span className="text-[14.5px]">{dict.comparison.sonda.title}</span>
                  </div>
                  <Badge className="h-auto rounded-full bg-warn-bg px-2.5 py-1 text-[11.5px] uppercase tracking-[0.04em] text-warn hover:bg-warn-bg">
                    {dict.comparison.sonda.confirmed}
                  </Badge>
                </div>

                <CardContent className="flex flex-col gap-4.5 p-5 sm:p-5.5">
                  <div className="flex flex-col gap-2">
                    <div className="text-[11.5px] uppercase tracking-[0.09em] text-neutral-500">{dict.comparison.sonda.whyHappened}</div>
                    <div className="flex flex-col gap-2">
                      {dict.comparison.sonda.causes.map((c, i) => (
                        <div key={c.label} className="flex items-center gap-3">
                          <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-neutral-800">
                            <div className={`h-full ${CAUSE_BAR_CLASSES[i]}`} style={{ width: `${c.pct}%` }} />
                          </div>
                          <span className="w-[19ch] shrink-0 text-[13.5px]">{c.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="m-0 mt-1 text-[13.5px] leading-[1.6] text-neutral-400">{dict.comparison.sonda.explanation}</p>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-divider pt-4">
                    <div className="text-[11.5px] uppercase tracking-[0.09em] text-neutral-500">{dict.comparison.sonda.affects.label}</div>
                    <p className="m-0 text-[13.5px] leading-[1.6] text-neutral-400">{dict.comparison.sonda.affects.body}</p>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-divider pt-4">
                    <div className="text-[11.5px] uppercase tracking-[0.09em] text-neutral-500">{dict.comparison.sonda.fix.label}</div>
                    <p className="m-0 text-[13.5px] leading-[1.6] text-neutral-400">{dict.comparison.sonda.fix.body}</p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-divider pt-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11.5px] uppercase tracking-[0.09em] text-neutral-500">{dict.comparison.sonda.cost.label}</span>
                      <span className="text-[19px] font-medium">{dict.comparison.sonda.cost.value}</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[13.5px] text-accent-400">
                      <FileTextIcon size={16} />
                      {dict.comparison.sonda.exportReport}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[13px] text-neutral-500">{dict.comparison.readToAnswer}</span>
              {dict.comparison.readToAnswerTags.map((r) => (
                <Badge key={r} variant="outline" className="h-auto rounded-full border-divider bg-surface px-3 py-1.5 text-[13px] font-normal text-neutral-400">
                  {r}
                </Badge>
              ))}
            </div>
            <Badge
              variant="outline"
              className="mt-5.5 h-auto gap-2 rounded-full border-accent-700 bg-surface px-3.5 py-1.5 text-[12.5px] font-normal text-accent-400"
            >
              <SparkleIcon size={14} />
              {dict.comparison.payPerReport}
            </Badge>
          </div>
        </section>

        {/* ————————————————————————— Pricing ————————————————————————— */}
        <section className="mx-auto flex max-w-[1140px] flex-col items-center gap-5 px-5 py-20 text-center sm:px-8 lg:py-[104px]">
          <div className="text-[13px] uppercase tracking-[0.1em] text-neutral-500">{dict.pricing.kicker}</div>
          <h2 className="max-w-[26ch] text-[32px] font-medium leading-[1.1] tracking-[-0.02em] sm:text-[38px] lg:text-[44px] lg:leading-[1.08] lg:tracking-[-0.025em]">
            {dict.pricing.heading}
          </h2>
          <p className="max-w-[54ch] text-[15.5px] leading-[1.6] text-neutral-400 sm:text-[16.5px]">{dict.pricing.body}</p>
          <div className="grid w-full max-w-[900px] grid-cols-1 gap-5 pt-3.5 text-left sm:grid-cols-2">
            <PricingCard title={dict.pricing.individuals.title} tag={dict.pricing.individuals.tag}>
              {dict.pricing.individuals.rows.map((row, i) => (
                <PricingRow key={row} Icon={i === dict.pricing.individuals.rows.length - 1 ? SparkleIcon : CheckIcon}>
                  {row}
                </PricingRow>
              ))}
            </PricingCard>
            <PricingCard title={dict.pricing.shops.title} tag={dict.pricing.shops.tag} featured>
              {dict.pricing.shops.rows.map((row, i) => {
                const Icon = i === dict.pricing.shops.rows.length - 1 ? PlusIcon : i === dict.pricing.shops.rows.length - 2 ? SparkleIcon : CheckIcon;
                return (
                  <PricingRow key={row} Icon={Icon}>
                    {row}
                  </PricingRow>
                );
              })}
            </PricingCard>
          </div>
          <FooterCta dict={dict} />
        </section>
      </main>

      {/* ————————————————————————— Footer ————————————————————————— */}
      <footer className="relative overflow-hidden bg-section">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_20%_0%,var(--section-glow),transparent_70%)] opacity-60" />
        <div className="relative mx-auto flex max-w-[1140px] flex-wrap items-start justify-between gap-9 px-5 py-11 sm:px-8">
          <div className="flex flex-col items-start gap-3.5">
            <Wordmark size={22} tone="color" textClassName="text-[16px] text-section-text" />
            <div className="text-[13.5px] text-section-subtle">{dict.footer.tagline}</div>
            <LocaleSwitchLink to={otherLocale} href={otherLocaleHref} className="text-[12.5px] text-section-accent hover:text-section-accent-strong">
              {dict.footer.switchTo}
            </LocaleSwitchLink>
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-[11.5px] uppercase tracking-[0.09em] text-section-faint">{dict.footer.platforms}</div>
            <div className="flex flex-wrap gap-2">
              <FooterPlatform icon={<DownloadIcon size={14} />} label={dict.footer.macAvailable} active />
              <FooterPlatform label={dict.footer.windowsSoon} />
              <FooterPlatform label={dict.footer.iphoneSoon} />
              <FooterPlatform label={dict.footer.androidSoon} />
            </div>
          </div>
        </div>
        <div className="relative mx-auto max-w-[1140px] px-5 pb-8 text-[12.5px] text-section-faintest sm:px-8">{dict.footer.copyright}</div>
      </footer>
    </div>
  );
}

function PricingCard({ title, tag, featured, children }: { title: string; tag: string; featured?: boolean; children: React.ReactNode }) {
  return (
    <Card
      className={`gap-4.5 rounded-[var(--radius-md)] p-6 shadow-none ring-0 ${
        featured ? "border-accent-700 bg-accent-900" : "border-divider bg-surface"
      }`}
    >
      <CardContent className="flex flex-col gap-4.5 p-0">
        <div className="flex flex-col gap-1">
          <span className="text-[20px] font-medium">{title}</span>
          <span className="text-[15px] font-medium text-accent-400">{tag}</span>
        </div>
        <div className="flex flex-col gap-2.5 text-[14px] text-neutral-400">{children}</div>
      </CardContent>
    </Card>
  );
}

function PricingRow({ Icon, children }: { Icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <span className="flex gap-2.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-accent-400" />
      {children}
    </span>
  );
}

function FooterPlatform({ icon, label, active }: { icon?: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={`h-auto gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-normal ${
        active ? "border-section-divider-strong bg-section-chip-bg text-section-text" : "border-section-divider text-section-subtle"
      }`}
    >
      {icon}
      {label}
    </Badge>
  );
}
