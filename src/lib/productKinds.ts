/** Detect combo rows from optional fields used by seller / buyer apps. */
export function isComboProduct(p: {
  isCombo?: boolean;
  itemType?: string;
  type?: string;
  category?: string;
}): boolean {
  if (p.isCombo === true) return true;
  const t = String(p.itemType ?? p.type ?? "").toLowerCase();
  if (t === "combo") return true;
  if (String(p.category ?? "").toLowerCase() === "combo") return true;
  return false;
}
