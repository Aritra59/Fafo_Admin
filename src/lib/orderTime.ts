import type { Timestamp } from "firebase/firestore";
import type { Order } from "../types/models";

export function orderTimeMs(o: Order): number {
  const v = o.createdAt as Timestamp | string | undefined;
  if (!v) return 0;
  try {
    if (typeof v === "string") return new Date(v).getTime();
    if (typeof (v as Timestamp).toMillis === "function") return (v as Timestamp).toMillis();
    return 0;
  } catch {
    return 0;
  }
}
