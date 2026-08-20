// VIN structure beyond the brand (see brand.ts for the WMI → brand table).
//
// What's actually decodable, and how, is split in two very different ways:
//
// 1. Model YEAR (VIN position 10) is ISO 3779 standard — every
//    manufacturer worldwide uses the same letter/digit table. This works
//    offline, for any brand, with zero external data. decodeModelYear does
//    this.
//
// 2. Model NAME/trim (positions 4-8, the "VDS") has no such standard. Each
//    manufacturer defines its own scheme, most don't publish it, and it
//    differs by market — there is no free, comprehensive, offline table
//    that could cover this for European-market cars, and building one by
//    hand ("a JSON of every brand and every model") is not a realistic
//    scope for this app to maintain correctly. Checked directly (not
//    assumed) against NHTSA's own free VIN-decode API
//    (vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}) before writing
//    this comment:
//      - A real Ford VIN decodes cleanly: Make FORD, Model F-150, Year 2022.
//      - This app's own demo VIN (a Citroen, VR7-prefixed) fails outright:
//        "Manufacturer is not registered with NHTSA for sale or
//        importation in the U.S." Citroen doesn't sell in the US, so this
//        isn't a demo-data quirk — every real Citroen VIN hits the same
//        wall, and Citroen/Peugeot/Renault/Seat/Dacia/Fiat cover a large
//        share of what's actually on Spanish roads.
//    NHTSA is genuinely useful for the brands that DO sell in the US
//    (Toyota, VW, Ford, Hyundai, Kia, BMW, Mercedes, Nissan, Mazda, Honda,
//    Volvo...), worth wiring up as a best-effort online lookup with a
//    graceful "unknown model" fallback. It is not a fix for the rest,
//    including the app's own reference car.

const YEAR_CODES: Record<string, number> = {
  A: 1980, B: 1981, C: 1982, D: 1983, E: 1984, F: 1985, G: 1986, H: 1987,
  J: 1988, K: 1989, L: 1990, M: 1991, N: 1992, P: 1993, R: 1994, S: 1995,
  T: 1996, V: 1997, W: 1998, X: 1999, Y: 2000,
  "1": 2001, "2": 2002, "3": 2003, "4": 2004, "5": 2005, "6": 2006,
  "7": 2007, "8": 2008, "9": 2009,
};

/**
 * Decodes the model year from VIN position 10 (ISO 3779, standard across
 * every manufacturer and market, no lookup table beyond this one needed).
 *
 * The code cycles every 30 years (A means both 1980 and 2010), so this
 * needs a tie-break. The commonly used heuristic keys off position 7: for
 * 17-character North-American-format VINs, a numeric position 7 means the
 * earlier cycle, an alphabetic one means 2010+. That heuristic doesn't hold
 * for every market's VIN format, so as a second-order check this also just
 * refuses to return a year that would be in the future or absurdly old
 * (pre-1980, before this scheme started) — better to say nothing than
 * guess wrong. Returns null for anything it isn't confident about.
 */
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

  // Refuse anything outside a sane window rather than assert a wrong year.
  if (candidate < 1980 || candidate > currentYear + 1) {
    // Try the other cycle before giving up entirely — the position-7
    // heuristic is a convention, not a guarantee.
    const other = laterCycle ? base : base + 30;
    return other >= 1980 && other <= currentYear + 1 ? other : null;
  }
  return candidate;
}
