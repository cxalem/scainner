import { Suspense, lazy, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HardDrive, MailOpen, Send, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND, Wordmark } from "@/brand";
import { Button, Field, Input } from "@/components/ui";
import { useEmailOtp } from "@/features/account/useEmailOtp";
import { MODELED_BRANDS } from "@/lib/brand";
import { appearVariants, fadeVariants, screenVariants, staggerContainer, staggerItem } from "@/motion";
import { useT } from "@/i18n";

const VehicleScene = lazy(() => import("@/components/VehicleScene").then((m) => ({ default: m.VehicleScene })));

const CAROUSEL_MS = 3400;
const CHIP_COUNT = 8;

export function Login({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  const otp = useEmailOtp();
  const [idx, setIdx] = useState(0);
  const brands = MODELED_BRANDS;

  useEffect(() => {
    if (brands.length === 0) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % brands.length), CAROUSEL_MS);
    return () => window.clearInterval(id);
  }, [brands.length]);

  useEffect(() => {
    const current = brands[idx];
    if (!current) return;
    void import("@/components/VehicleScene").then((m) => m.preloadEmblem(current.key));
  }, [idx, brands]);

  useEffect(() => {
    if (otp.userEmail) onContinue();
  }, [otp.userEmail, onContinue]);

  const current = brands[idx] ?? null;
  const chips = brands.slice(0, CHIP_COUNT);
  const canSend = otp.email.includes("@") && !otp.busy;

  return (
    <motion.div
      className="fixed inset-0 grid min-h-0 bg-bg text-text"
      style={{ gridTemplateColumns: "1.15fr 470px" }}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={screenVariants}
    >
      <div className="relative flex flex-col gap-[22px] overflow-hidden bg-section px-[42px] pb-[34px] pt-[38px] text-section-text">
        <div
          aria-hidden="true"
          className="animate-glow-slow absolute inset-0"
          style={{ background: "radial-gradient(70% 55% at 62% 30%, var(--section-glow), transparent 72%)" }}
        />
        <motion.div variants={fadeVariants} initial="hidden" animate="visible" className="relative">
          <Wordmark size="lg" tone="color" className="text-section-text" />
        </motion.div>

        <div className="relative flex min-h-[180px] flex-1 items-center justify-center">
          <Suspense fallback={null}>
            <VehicleScene
              status="connecting"
              brandKey={current?.key ?? null}
              caption={null}
              background="dust"
              className="absolute inset-0 h-full w-full rounded-none"
            />
          </Suspense>
        </div>

        <motion.div
          className="relative flex max-w-[26ch] flex-col gap-3.5"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          <motion.h1 variants={appearVariants} className="text-[34px] leading-[1.14] text-section-headline" style={{ textWrap: "pretty" }}>
            {t.login.headline}
          </motion.h1>
          <motion.p variants={appearVariants} className="text-[14px] leading-[1.6] text-section-text/80">
            {t.login.sub(brands.length)}
          </motion.p>
        </motion.div>

        <div
          className="relative flex shrink-0 gap-1.5 overflow-hidden"
          style={{ maskImage: "linear-gradient(90deg, #000 78%, transparent)" }}
        >
          {chips.map((b, i) => {
            const on = i === idx % brands.length;
            return (
              <span
                key={b.key}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.08em] transition-all duration-500",
                  on ? "border-section-chip-border bg-section-chip-bg text-section-chip-text" : "border-section-text/15 text-section-text/40",
                )}
              >
                {b.name}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-center bg-bg p-8">
        <AnimatePresence mode="wait" initial={false}>
          {otp.step === "email" ? (
            <motion.div
              key="email"
              className="flex w-full max-w-[340px] flex-col gap-[18px]"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={appearVariants}
            >
              <div className="flex flex-col gap-1.5">
                <h2 className="text-[24px]">{t.login.signIn}</h2>
                <p className="text-[13.5px] leading-[1.55] text-neutral-500">{t.login.signInSub}</p>
              </div>
              <form
                className="flex flex-col gap-[9px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSend) void otp.sendCode();
                }}
              >
                <Field label={t.login.emailLabel} htmlFor="login-email">
                  <Input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    placeholder={t.login.emailPlaceholder}
                    value={otp.email}
                    onChange={(e) => otp.setEmail(e.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" block icon={Send} busy={otp.busy} disabled={!canSend}>
                  {otp.busy ? t.login.sending : t.login.sendLink}
                </Button>
              </form>
              {otp.authError && <p className="text-[12px] text-stop">{otp.authError}</p>}
              <Button variant="ghost" size="sm" className="self-start" onClick={onContinue}>
                {t.login.continueOffline}
              </Button>
              <motion.div
                className="flex flex-col gap-2 border-t border-divider pt-3.5 text-[12px] leading-[1.5] text-neutral-500"
                initial="hidden"
                animate="visible"
                variants={staggerContainer}
              >
                <motion.span variants={staggerItem} className="flex gap-2">
                  <HardDrive className="h-[15px] w-[15px] shrink-0 text-neutral-600" aria-hidden="true" />
                  {t.login.localNote(BRAND.name)}
                </motion.span>
                <motion.span variants={staggerItem} className="flex gap-2">
                  <ShieldCheck className="h-[15px] w-[15px] shrink-0 text-neutral-600" aria-hidden="true" />
                  {t.login.shareNote}
                </motion.span>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="code"
              className="flex w-full max-w-[340px] flex-col gap-4"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={appearVariants}
            >
              <div className="animate-glow flex h-[46px] w-[46px] items-center justify-center rounded-full border border-accent-700 bg-accent-900">
                <MailOpen className="h-[22px] w-[22px] text-accent-400" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-[23px]">{t.login.checkInbox}</h2>
                <p className="text-[13.5px] leading-[1.6] text-neutral-500">{t.login.sentTo(otp.email.trim())}</p>
              </div>
              <form
                className="flex flex-col gap-[9px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (otp.code.length >= 6 && !otp.busy) void otp.verify();
                }}
              >
                <Field label={t.login.codeLabel} htmlFor="login-code" hint={t.login.codeHint}>
                  <Input
                    id="login-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    className="num tracking-[0.3em]"
                    placeholder="123456"
                    value={otp.code}
                    onChange={(e) => otp.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" block busy={otp.busy} disabled={otp.code.length < 6 || otp.busy}>
                  {otp.busy ? t.login.verifying : t.login.verify}
                </Button>
              </form>
              {otp.authError && <p className="text-[12px] text-stop">{otp.authError}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => otp.setStep("email")}>
                  {t.login.useAnother}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void otp.sendCode()} disabled={otp.busy}>
                  {t.login.resend}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
