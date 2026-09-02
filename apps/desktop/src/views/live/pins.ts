import { useCallback, useEffect, useState } from "react";

const keyFor = (vehicleId: number | null) => `live.pins.${vehicleId ?? "none"}`;

function read(vehicleId: number | null): string[] {
  try {
    const raw = window.localStorage.getItem(keyFor(vehicleId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function usePins(vehicleId: number | null) {
  const [pins, setPins] = useState<string[]>(() => read(vehicleId));
  useEffect(() => setPins(read(vehicleId)), [vehicleId]);
  const toggle = useCallback(
    (key: string) => {
      setPins((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        try {
          window.localStorage.setItem(keyFor(vehicleId), JSON.stringify(next));
        } catch {
        }
        return next;
      });
    },
    [vehicleId],
  );
  return { pins, toggle };
}
