import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Ride, RideStatus } from "@scainner/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Grow } from "@/motion/components";
import { useT } from "@/i18n";
import { rideSummaryCopyKey } from "@/lib/ride-copy";
import { ReportAction } from "@/components/ReportAction";

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
    <Grow when={Boolean(ride || completed)} boxClassName="relative z-30 shadow-sm">
      <Alert
        role="status"
        aria-live="polite"
        className="grid min-h-14 w-full gap-0 rounded-none border-0 border-b border-divider px-6 py-2 text-[13px]"
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={ride ? "recording" : "completed"}
            style={{ gridArea: "1 / 1" }}
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            {ride ? (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-stop" aria-hidden="true" />
                <AlertTitle>{t.ride.recording}</AlertTitle>
                <Badge variant="secondary" className="num">{elapsedLabel(elapsed)}</Badge>
                <Badge variant="secondary" className="num">{t.ride.samples(ride.sample_count)}</Badge>
                <span className="flex-1" />
                <Button className="min-h-10" variant="destructive" size="sm" disabled={stopping} onClick={onStop}>{t.ride.stop}</Button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <AlertTitle>{firstLine}</AlertTitle>
                  <AlertDescription className="text-[12px]">{t.ride.location}</AlertDescription>
                </div>
                <ReportAction input={{ kind: "ride", ride_id: completed!.cloud_id }} label={(price) => t.ride.report(price)} />
                <Button className="min-h-10" variant="outline" onClick={onDone}>{t.ride.done}</Button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </Alert>
    </Grow>
  );
}
