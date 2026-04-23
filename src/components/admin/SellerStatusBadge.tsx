import type { Seller } from "../../types/models";
import { sellerDisplayLabel, sellerOperationalCategory } from "../../services/adminFirestore";

export function SellerStatusBadge({ seller }: { seller: Seller }) {
  const cat = sellerOperationalCategory(seller);
  const map: Record<string, { className: string }> = {
    blocked: { className: "pill pill--danger" },
    suspended: { className: "pill pill--suspended" },
    live: { className: "pill pill--live" },
    trial: { className: "pill pill--trial" },
    demo: { className: "pill pill--demo" },
  };
  const m = map[cat] ?? map.demo;
  return <span className={m.className}>{sellerDisplayLabel(seller)}</span>;
}
