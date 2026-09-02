export const GAUGE_RANGES: Record<string, { lo: number; hi: number }> = {
  rpm: { lo: 0, hi: 6000 },
  speed: { lo: 0, hi: 200 },
  coolant: { lo: 0, hi: 120 },
  voltage: { lo: 9, hi: 15 },
  load: { lo: 0, hi: 100 },
  throttle: { lo: 0, hi: 100 },
  intake_temp: { lo: -10, hi: 60 },
  map: { lo: 0, hi: 120 },
  stft: { lo: -25, hi: 25 },
  ltft: { lo: -25, hi: 25 },
  fuel_rate: { lo: 0, hi: 20 },
  fuel_level: { lo: 0, hi: 100 },
};

export function percentOf(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
}
