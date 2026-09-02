import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Ride, RideStatus } from "@scainner/core";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { rideSummaryCopyKey } from "@/lib/ride-copy";

export const AI_REPORT_PRICE = "€—";

function elapsedSeconds(startedAt: string, endedAt?: string | null): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function RideBanner({ ride, completed, stopping, onStop, onDone }: {
  ride: RideStatus | null;
  completed: Ride | null;
  stopping: boolean;
  onStop: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(() => ride ? elapsedSeconds(ride.started_at) : 0);

  useEffect(() => {
    if (!ride) return;
    setElapsed(elapsedSeconds(ride.started_at));
    const timer = window.setInterval(() => setElapsed(elapsedSeconds(ride.started_at)), 1000);
    return () => window.clearInterval(timer);
  }, [ride?.id, ride?.started_at]);

  const transition = { duration: reduced ? 0 : 0.22 };
  const firstLine = completed ? (() => {
    const minutes = Math.round(elapsedSeconds(completed.started_at, completed.ended_at) / 60);
    const key = rideSummaryCopyKey(completed.dtc_codes_appeared);
    return key === "many"
      ? t.ride.saved.many(minutes, completed.sensor_count, completed.dtc_codes_appeared)
      : t.ride.saved[key](minutes, completed.sensor_count);
  })() : null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {(ride || completed) ? (
        <motion.section
          key={ride ? "recording" : "completed"}
          role="status"
          aria-live="polite"
          initial={reduced ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, y: -10 }}
          transition={transition}
          className="relative z-30 flex min-h-14 w-full items-center gap-3 border-b border-divider bg-surface px-6 py-2 shadow-sm"
        >
          {ride ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-stop" aria-hidden="true" />
              <span className="font-medium">{t.ride.recording}</span>
              <span className="num text-neutral-400">{elapsedLabel(elapsed)}</span>
              <span className="num text-neutral-500">{t.ride.samples(ride.sample_count)}</span>
              <span className="flex-1" />
              <Button className="min-h-10" variant="destructive" size="sm" disabled={stopping} onClick={onStop}>{t.ride.stop}</Button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{firstLine}</p>
                <p className="text-[12px] text-neutral-500">{t.ride.location}</p>
              </div>
              <Button className="min-h-10" disabled>{t.ride.report(AI_REPORT_PRICE)}</Button>
              <Button className="min-h-10" variant="outline" onClick={onDone}>{t.ride.done}</Button>
            </>
          )}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
