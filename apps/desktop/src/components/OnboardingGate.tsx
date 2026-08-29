// The very first screen on a fresh install, shown once ever: pick a
// language. One tap both picks and confirms. Labels are always in their
// own language — this is the one screen that has to read before a locale
// is chosen, so it does not go through useT().
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { MOCK_MODE } from "@/lib/tauri";
import { Wordmark } from "@/brand";
import { Pill } from "@/components/ui";
import { screenVariants, staggerContainer, staggerItem } from "@/motion";
import { useLocale, type Locale } from "@/i18n";

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

export function OnboardingGate({ onDone }: { onDone: () => void }) {
  const { locale, setLocale } = useLocale();
  const choose = (next: Locale) => {
    setLocale(next);
    onDone();
  };

  return (
    <motion.div
      className="relative flex h-screen items-center justify-center bg-bg text-text"
      style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-900), var(--bg) 70%)" }}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={screenVariants}
    >
      {MOCK_MODE && (
        <Pill variant="warn" className="absolute right-4 top-4">
          Demo data
        </Pill>
      )}
      <motion.div className="flex flex-col items-center gap-6 text-center" initial="hidden" animate="visible" variants={staggerContainer}>
        <motion.div variants={staggerItem}>
          <Wordmark size="lg" markClassName="text-accent-400" />
        </motion.div>
        <motion.p variants={staggerItem} className="text-[13.5px] text-neutral-500">
          Choose your language / Elige tu idioma
        </motion.p>
        <motion.div variants={staggerItem} role="group" aria-label="Language / Idioma" className="flex items-center gap-3">
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => choose(l.value)}
              aria-pressed={locale === l.value}
              className={cn(
                "flex h-10 min-w-32 items-center justify-center rounded-md border px-6 text-[14px] font-heading font-medium",
                "transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.985]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                locale === l.value
                  ? "border-accent bg-accent-900 text-accent"
                  : "border-divider bg-surface text-text hover:border-accent-600",
              )}
            >
              {l.label}
            </button>
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
