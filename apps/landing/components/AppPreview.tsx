import { Fragment } from "react";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { CaretDownIcon, CaretRightIcon, CarIcon, EraserIcon, FlaskIcon, GaugeIcon, PulseIcon, SparkleIcon, StethoscopeIcon, WrenchIcon } from "@/components/Icon";

const OTHER_FAULT_TONES = ["bg-neutral-800 text-neutral-400", "bg-info-bg text-info"];

const CHIP = "inline-flex items-center gap-1.5 rounded-[6px] border px-3 py-[7px] text-[12px]";
const SECTION_LABEL = "text-[10.5px] uppercase tracking-[0.08em] text-neutral-600";
const FIELD_LABEL = "text-[10.5px] uppercase tracking-[0.08em] text-neutral-500";
const STATUS = "rounded-full px-2 py-[3px] text-[10.5px] uppercase tracking-[0.04em]";

export function AppPreview({ dict }: { dict: Dictionary }) {
  const p = dict.showcase.preview;

  return (
    <figure className="m-0 overflow-hidden rounded-[var(--radius-lg)] border border-divider bg-surface shadow-lg">
      <figcaption className="sr-only">{dict.showcase.screenshotAlt}</figcaption>

      <div aria-hidden="true">
        {/* macOS window-control colours, quoted literally: an OS artefact, not a brand decision. */}
        <div className="flex items-center gap-2 border-b border-divider bg-neutral-900 px-3.5 py-[11px]">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="flex-1 text-center text-[12px] text-neutral-500 sm:mr-[52px]">{p.windowTitle}</span>
        </div>

        <div className="relative grid grid-cols-1 overflow-hidden bg-bg lg:aspect-[16/10] lg:grid-cols-[196px_minmax(0,1fr)]">
          {/* Below lg the frame flows instead of holding 16/10, so the 196px rail is dropped rather than squeezed. */}
          <div className="hidden flex-col gap-1 border-r border-divider bg-surface px-3 py-4 lg:flex">
            <div className={`${SECTION_LABEL} px-2.5 pb-2`}>{p.sidebarPrimary}</div>
            <NavItem icon={<GaugeIcon size={14} />} label={p.nav.overview} />
            <NavItem icon={<StethoscopeIcon size={14} />} label={p.nav.diagnose} active />
            <NavItem icon={<PulseIcon size={14} />} label={p.nav.live} />
            <NavItem icon={<WrenchIcon size={14} />} label={p.nav.workshop} />
            <div className={`${SECTION_LABEL} px-2.5 pb-2 pt-4`}>{p.sidebarAdvanced}</div>
            <NavItem icon={<FlaskIcon size={14} />} label={p.nav.lab} />
            <NavItem icon={<CarIcon size={14} />} label={p.nav.vehicle} />
            <div className="mt-auto flex items-center gap-2 rounded-[6px] bg-accent-900 p-2.5 text-[12px] text-neutral-400">
              <span className="size-[7px] shrink-0 rounded-full bg-ok" />
              {p.adapter}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4.5 p-5 sm:p-6 lg:px-[30px] lg:py-[26px]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[22px] font-medium">{p.title}</span>
                <span className="text-[12.5px] text-neutral-500">{p.subtitle}</span>
              </div>
              <div className="flex gap-2">
                <span className={`${CHIP} border-divider text-neutral-400`}>{p.rescan}</span>
                <span className={`${CHIP} border-accent-400 text-accent-400`}>
                  <EraserIcon size={13} />
                  {p.clearCodes}
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-[10px] border border-divider bg-surface">
              <FaultRow
                className="bg-accent-900"
                code={p.primaryFault.code}
                codeClassName="text-accent-400"
                title={p.primaryFault.title}
                titleClassName="font-medium"
                module={p.primaryFault.module}
                status={p.primaryFault.status}
                statusClassName="bg-warn-bg text-warn"
                caret={<CaretDownIcon size={13} className="text-neutral-600" />}
              />

              <div className="grid grid-cols-1 gap-5 border-t border-divider p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="flex flex-col gap-2">
                  <span className={FIELD_LABEL}>{p.meaningLabel}</span>
                  <p className="m-0 text-[12.5px] leading-[1.55] text-neutral-400">{p.primaryFault.meaning}</p>
                  <div className="mt-1 flex">
                    <span className={`${CHIP} border-accent-400 text-accent-400`}>
                      <SparkleIcon size={13} />
                      {p.askSonda}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={FIELD_LABEL}>{p.freezeFrameLabel}</span>
                  <div className="grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-[5px] text-[12px] text-neutral-400">
                    {p.freezeFrame.map(({ label, value }) => (
                      <Fragment key={label}>
                        <span>{label}</span>
                        <span className="font-mono">{value}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>

              {p.otherFaults.map((fault, i) => (
                <FaultRow
                  key={fault.code}
                  className="border-t border-divider"
                  code={fault.code}
                  title={fault.title}
                  module={fault.module}
                  status={fault.status}
                  statusClassName={OTHER_FAULT_TONES[i]!}
                  caret={<CaretRightIcon size={13} className="text-neutral-600" />}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function NavItem({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-[12.5px] ${
        active ? "bg-accent-200 font-medium text-accent-400" : "text-neutral-400"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

function FaultRow({
  className,
  code,
  codeClassName = "",
  title,
  titleClassName = "",
  module,
  status,
  statusClassName,
  caret,
}: {
  className: string;
  code: string;
  codeClassName?: string;
  title: string;
  titleClassName?: string;
  module: string;
  status: string;
  statusClassName: string;
  caret: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3.5 ${className}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className={`w-[6ch] shrink-0 font-mono text-[12.5px] font-semibold ${codeClassName}`}>{code}</span>
        <span className={`min-w-0 text-[13px] ${titleClassName}`}>{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3.5">
        <span className="text-[11.5px] text-neutral-500">{module}</span>
        <span className={`${STATUS} ${statusClassName}`}>{status}</span>
        {caret}
      </div>
    </div>
  );
}
