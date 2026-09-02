export type RideSummaryCopyKey = "none" | "one" | "many";

export function rideSummaryCopyKey(dtcCodesAppeared: number): RideSummaryCopyKey {
  if (dtcCodesAppeared <= 0) return "none";
  return dtcCodesAppeared === 1 ? "one" : "many";
}
