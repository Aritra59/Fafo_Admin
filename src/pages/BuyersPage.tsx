import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { COLLECTIONS, downloadTextFile, toCsvRow } from "../services/adminFirestore";
import { formatMoney, formatDate, waLink } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BuyerUser, Order } from "../types/models";

function isBuyer(u: BuyerUser): boolean {
  const r = u.role ?? "buyer";
  return r === "buyer";
}

export function BuyersPage() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [users, setUsers] = useState<BuyerUser[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, COLLECTIONS.users), (snap) => {
      const list: BuyerUser[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setUsers(list);
    });
    const u2 = onSnapshot(collection(db, COLLECTIONS.orders), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setOrders(list);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  const buyers = useMemo(() => users.filter(isBuyer), [users]);

  const byPhone = useMemo(() => {
    const m = new Map<string, { orders: number; spend: number; lastMs: number; sellerCounts: Map<string, number> }>();
    for (const o of orders) {
      const p = (o.buyerPhone ?? "").trim();
      if (!p) continue;
      const cur = m.get(p) ?? { orders: 0, spend: 0, lastMs: 0, sellerCounts: new Map() };
      cur.orders += 1;
      cur.spend += Number(o.total ?? 0);
      const t = orderTimeMs(o);
      if (t > cur.lastMs) cur.lastMs = t;
      const sid = o.sellerId ?? "";
      if (sid) cur.sellerCounts.set(sid, (cur.sellerCounts.get(sid) ?? 0) + 1);
      m.set(p, cur);
    }
    return m;
  }, [orders]);

  const [sellerNames, setSellerNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const m = new Map<string, string>();
      snap.forEach((d) => {
        const data = d.data() as DocumentData;
        m.set(d.id, (data.shopName as string) ?? d.id);
      });
      setSellerNames(m);
    });
  }, []);

  async function toggleBlock(u: BuyerUser) {
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.users, u.id), { isBlocked: !u.isBlocked });
    } finally {
      setBusy(false);
    }
  }

  async function removeBuyer(u: BuyerUser) {
    if (!window.confirm(`Delete buyer ${u.name ?? u.phone ?? u.id}?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.users, u.id));
    } finally {
      setBusy(false);
    }
  }

  function exportBuyers() {
    const rows = [
      toCsvRow(["ID", "Name", "Phone", "Orders", "Spend", "Last order", "Favorite shop", "Status"]),
      ...buyers.map((u) => {
        const phone = (u.phone ?? "").trim();
        const agg = byPhone.get(phone) ?? { orders: 0, spend: 0, lastMs: 0, sellerCounts: new Map() };
        let fav = "";
        let n = 0;
        for (const [sid, c] of agg.sellerCounts) {
          if (c > n) {
            n = c;
            fav = sid;
          }
        }
        const favName = fav ? sellerNames.get(fav) ?? fav : "";
        const last = agg.lastMs ? formatDate(new Date(agg.lastMs) as never) : "—";
        return toCsvRow([
          u.id,
          u.name ?? "",
          u.phone ?? "",
          agg.orders,
          agg.spend,
          last,
          favName,
          u.isBlocked ? "blocked" : "active",
        ]);
      }),
    ];
    downloadTextFile("buyers-export.csv", rows.join("\n"));
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Buyers</h1>
          <p className="muted">Users with role buyer · favorite shop inferred from orders</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to={`${base}/create-buyer`}>
            Create buyer
          </Link>
          <Button variant="ghost" onClick={() => exportBuyers()}>
            Export CSV
          </Button>
        </div>
      </header>

      <Card>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Orders</th>
                <th>Spend</th>
                <th>Last order</th>
                <th>Favorite shop</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {buyers.map((u) => {
                const phone = (u.phone ?? "").trim();
                const agg = byPhone.get(phone) ?? { orders: 0, spend: 0, lastMs: 0, sellerCounts: new Map() };
                let fav = "";
                let n = 0;
                for (const [sid, c] of agg.sellerCounts) {
                  if (c > n) {
                    n = c;
                    fav = sid;
                  }
                }
                const favName = fav ? sellerNames.get(fav) ?? fav : u.favoriteShopName ?? "—";
                const last = agg.lastMs ? formatDate(new Date(agg.lastMs) as never) : "—";
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-strong">{u.name ?? "—"}</div>
                    </td>
                    <td>{u.phone ?? "—"}</td>
                    <td className="cell-clamp small">{u.address ?? u.location ?? "—"}</td>
                    <td>{agg.orders}</td>
                    <td>{formatMoney(agg.spend)}</td>
                    <td className="muted small">{last}</td>
                    <td className="small">{favName}</td>
                    <td>{u.isBlocked ? <span className="pill pill--danger">Blocked</span> : <span className="pill pill--live">Active</span>}</td>
                    <td className="actions-cell">
                      <div className="btn-row">
                        <Link className="btn btn--ghost" to={`${base}/buyer/${u.id}`}>
                          Open
                        </Link>
                        <Button variant="ghost" onClick={() => void toggleBlock(u)} disabled={busy}>
                          {u.isBlocked ? "Unblock" : "Block"}
                        </Button>
                        <Button variant="danger" onClick={() => void removeBuyer(u)} disabled={busy}>
                          Delete
                        </Button>
                        <a className="btn btn--ghost" href={waLink(u.phone)} target="_blank" rel="noreferrer">
                          WA
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
