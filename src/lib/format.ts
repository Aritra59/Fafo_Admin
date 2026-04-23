import type { Timestamp } from "firebase/firestore";

export function formatMoney(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(v: Timestamp | string | undefined): string {
  if (!v) return "—";
  try {
    const d =
      typeof v === "string"
        ? new Date(v)
        : typeof (v as Timestamp).toDate === "function"
          ? (v as Timestamp).toDate()
          : new Date();
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export function waLink(phone: string | undefined): string {
  if (!phone) return "#";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "#";
  return `https://wa.me/${digits}`;
}

/** WhatsApp deep link with prefilled message (UTF-8). */
export function waMessageLink(phone: string | undefined, message: string): string {
  const base = waLink(phone);
  if (base === "#") return "#";
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function summarizeItems(items: unknown[] | undefined): string {
  if (!items?.length) return "—";
  return items
    .map((it) => {
      if (!it || typeof it !== "object") return "?";
      const o = it as Record<string, unknown>;
      const name = (o.name ?? o.title ?? "Item") as string;
      const q = (o.qty ?? o.quantity ?? 1) as number;
      return `${name} ×${q}`;
    })
    .join(", ");
}
