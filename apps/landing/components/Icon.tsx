// Generic icons: re-exported straight from lucide-react (the product's own
// icon library — apps/desktop/src/brand's own rule is "lucide-react only,
// no emojis"; this page follows the same convention). Renamed on the way
// out so call sites read by intent, not by lucide's own naming.
//
// OS-brand marks (Apple/Windows/Android) are hand-drawn below: lucide is a
// generic UI-icon set, not a brand-logo library, so there's no lucide
// equivalent for these three.
export {
  Download as DownloadIcon,
  SearchCheck as SearchListIcon,
  Eraser as EraserIcon,
  Activity as PulseIcon,
  FileDown as FileDownIcon,
  CheckCircle2 as CheckCircleIcon,
  Bell as BellIcon,
  Sparkles as SparkleIcon,
  FileText as FileTextIcon,
  Minus as MinusIcon,
  Check as CheckIcon,
  Plus as PlusIcon,
  ArrowRight as ArrowRightIcon,
  Smartphone as MobileIcon,
  Monitor as DesktopIcon,
  Plug as PlugIcon,
} from "lucide-react";

type IconProps = { size?: number; className?: string };

export function AppleIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.7 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.2-2.1-3.9-2.2-1.7-.2-3.3 1-4.1 1-.9 0-2.2-1-3.6-1-1.9 0-3.6 1.1-4.6 2.7-2 3.4-.5 8.5 1.4 11.3.9 1.3 2 2.9 3.5 2.8 1.4-.1 1.9-.9 3.6-.9s2.1.9 3.6.8c1.5 0 2.5-1.3 3.4-2.7.7-1.1 1-1.6 1.6-2.9-4.1-1.6-3.2-4.7-3.2-4.8zM13.8 4.7c.7-.9 1.2-2.1 1.1-3.4-1.1.1-2.4.7-3.1 1.6-.7.8-1.3 2-1.1 3.3 1.3.1 2.5-.6 3.1-1.5z"
      />
    </svg>
  );
}
export function WindowsIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d="M3 5.6 10.4 4.6V11.5H3zM11.4 4.4 21 3V11.5H11.4zM3 12.5H10.4V19.4L3 18.4zM11.4 12.5H21V21L11.4 19.6z" />
    </svg>
  );
}
export function AndroidIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="6" y="8" width="12" height="11" rx="2" />
      <path d="M8 4l1.5 2.2M16 4l-1.5 2.2" />
      <path d="M6 12H4M20 12h-2M9 21v1M15 21v1" />
    </svg>
  );
}
