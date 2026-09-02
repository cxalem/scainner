
const YEAR_CODES: Record<string, number> = {
  A: 1980, B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987,
  J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994, S: 1995,
  T: 1996, V: 1997, W: 1998, X: 1999, Y: 2000,
  "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005, "6": 2006,
  "7": 2007, "8": 2008, "9": 2009,
};

export function decodeModelYear(vin: string | null | undefined): number | null {
  if (!vin || vin.length !== 17) return null;
  const code = vin[9]?.toUpperCase();
  if (!code) return null;
  const base = YEAR_CODES[code];
  if (base === undefined) return null;

  const pos7 = vin[6];
  const laterCycle = /[A-Z]/i.test(pos7 ?? "");
  const currentYear = new Date().getFullYear();
  const candidate = laterCycle ? base + 30 : base;

  if (candidate < 1980 || candidate > currentYear + 1) {
    const other = laterCycle ? base : base + 30;
    return other >= 1980 && other <= currentYear + 1 ? other : null;
  }
  return candidate;
}
