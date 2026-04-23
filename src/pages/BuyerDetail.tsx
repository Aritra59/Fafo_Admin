import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { COLLECTIONS, downloadTextFile, toCsvRow, tsToDate } from "../services/adminFirestore";
import { formatMoney, formatDate, waLink } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BuyerUser, Order, Seller } from "../types/models";

export function BuyerDetail() {
  const { appName, buyerId } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [buyer, setBuyer] = useState<BuyerUser | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<null | "name" | "phone" | "address" | "loc">(null);
  const [editVal, setEditVal] = useState("");

  useEffect(() => {
    if (!buyerId) return;
    return onSnapshot(doc(db, COLLECTIONS.users, buyerId), (snap) => {
      if (!snap.exists()) {
        setBuyer(null);
        return;
      }
      setBuyer({ id: snap.id, ...(snap.data() as DocumentData) });
    });
  }, [buyerId]);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
  }, []);

  useEffect(() => {
    if (!buyer?.phone) {
      setOrders([]);
      return;
    }
    const phone = buyer.phone.trim();
    const q = query(collection(db, COLLECTIONS.orders), where("buyerPhone", "==", phone));
    return onSnapshot(q, (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => orderTimeMs(b) - orderTimeMs(a));
      setOrders(list);
    });
  }, [buyer?.phone]);

  const sellerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sellers) m.set(s.id, s.shopName ?? s.ownerName ?? s.id);
    return m;
  }, [sellers]);

  const stats = useMemo(() => {
    let spend = 0;
    let last: Date | null = null;
    const sellerCounts = new Map<string, number>();
    for (const o of orders) {
      spend += Number(o.total ?? 0);
      const t = tsToDate(o.createdAt as never);
      if (t && (!last || t > last)) last = t;
      const sid = o.sellerId ?? "";
      if (sid) sellerCounts.set(sid, (sellerCounts.get(sid) ?? 0) + 1);
    }
    let fav = "";
    let favN = 0;
    for (const [sid, n] of sellerCounts) {
      if (n > favN) {
        favN = n;
        fav = sid;
      }
    }
    const favoriteShop = fav ? sellerName.get(fav) ?? fav : buyer?.favoriteShopName ?? "—";
    return { spend, last, orderCount: orders.length, favoriteShop };
  }, [orders, sellerName, buyer?.favoriteShopName]);

  async function patchBuyer(patch: Record<string, unknown>) {
    if (!buyerId) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.users, buyerId), patch);
    } finally {
      setBusy(false);
    }
  }

  function exportBuyer() {
    if (!buyer) return;
    const rows = [
      toCsvRow(["Buyer ID", "Name", "Phone", "Orders", "Spend", "Favorite shop"]),
      toCsvRow([buyer.id, buyer.name ?? "", buyer.phone ?? "", stats.orderCount, stats.spend, stats.favoriteShop]),
    ];
    downloadTextFile(`buyer-${buyer.id}.csv`, rows.join("\n"));
  }

  function openEdit(kind: typeof edit) {
    if (!buyer) return;
    setEdit(kind);
    if (kind === "name") setEditVal(buyer.name ?? "");
    else if (kind === "phone") setEditVal(buyer.phone ?? "");
    else if (kind === "address") setEditVal(buyer.address ?? buyer.location ?? "");
    else if (kind === "loc") setEditVal(`${buyer.latitude ?? ""},${buyer.longitude ?? ""}`);
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (edit === "name") void patchBuyer({ name: editVal.trim() });
    else if (edit === "phone") void patchBuyer({ phone: editVal.trim() });
    else if (edit === "address") void patchBuyer({ address: editVal.trim(), location: editVal.trim() });
    else if (edit === "loc") {
      const [la, lo] = editVal.split(",").map((s) => Number(s.trim()));
      void patchBuyer({
        latitude: Number.isFinite(la) ? la : undefined,
        longitude: Number.isFinite(lo) ? lo : undefined,
      });
    }
    setEdit(null);
  }

  async function removeBuyer() {
    if (!buyerId || !buyer) return;
    if (!window.confirm("Delete this buyer permanently?")) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.users, buyerId));
    } finally {
      setBusy(false);
    }
  }

  if (!buyerId) return <div className="page muted">Missing buyer id.</div>;
  if (!buyer) return <div className="page muted">Loading…</div>;

  const roleOk = (buyer.role ?? "buyer") === "buyer";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{buyer.name ?? "Buyer"}</h1>
          <p className="muted mono">{buyer.id}</p>
        </div>
        <div className="btn-row">
          <Link className="btn btn--ghost" to={`${base}/buyers`}>
            ← Buyers
          </Link>
          <a className="btn btn--ghost" href={waLink(buyer.phone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <Button variant="ghost" onClick={() => exportBuyer()}>
            Export CSV
          </Button>
        </div>
      </header>

      {!roleOk ? <p className="error-text">This user is not role buyer.</p> : null}

      <div className="split-2">
        <Card title="Profile">
          <div className="kv-grid">
            <div className="kv">
              <div className="kv__k">Phone</div>
              <div className="kv__v">{buyer.phone ?? "—"}</div>
            </div>
            <div className="kv">
              <div className="kv__k">Status</div>
              <div className="kv__v">{buyer.isBlocked ? "Blocked" : "Active"}</div>
            </div>
            <div className="kv">
              <div className="kv__k">Orders</div>
              <div className="kv__v">{stats.orderCount}</div>
            </div>
            <div className="kv">
              <div className="kv__k">Total spend</div>
              <div className="kv__v">{formatMoney(stats.spend)}</div>
            </div>
            <div className="kv">
              <div className="kv__k">Last order</div>
              <div className="kv__v">{stats.last ? formatDate(stats.last as never) : "—"}</div>
            </div>
            <div className="kv">
              <div className="kv__k">Favorite shop</div>
              <div className="kv__v">{stats.favoriteShop}</div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <Button variant="ghost" disabled={busy} onClick={() => openEdit("name")}>
              Edit name
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => openEdit("phone")}>
              Edit phone
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => openEdit("address")}>
              Edit address
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => openEdit("loc")}>
              Lat/Lng
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void patchBuyer({ isBlocked: !buyer.isBlocked })}>
              {buyer.isBlocked ? "Unblock" : "Block"}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void removeBuyer()}>
              Delete buyer
            </Button>
          </div>
        </Card>

        <Card title="Recent orders">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Seller</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 12).map((o) => (
                  <tr key={o.id}>
                    <td className="muted small">{formatDate(o.createdAt as never)}</td>
                    <td>{sellerName.get(o.sellerId ?? "") ?? o.sellerId ?? "—"}</td>
                    <td>{formatMoney(Number(o.total))}</td>
                    <td>
                      <span className="pill">{o.status ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal
        open={!!edit}
        title={
          edit === "name"
            ? "Edit name"
            : edit === "phone"
              ? "Edit phone"
              : edit === "address"
                ? "Edit address"
                : "Lat , Lng"
        }
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button type="submit" form="buyer-edit-form">
              Save
            </Button>
          </>
        }
      >
        <form id="buyer-edit-form" onSubmit={(e) => void saveEdit(e)}>
          {edit === "address" ? (
            <textarea className="input input--area" rows={4} value={editVal} onChange={(e) => setEditVal(e.target.value)} />
          ) : (
            <input
              className="input"
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              placeholder={edit === "loc" ? "12.34,56.78" : undefined}
            />
          )}
        </form>
      </Modal>
    </div>
  );
}
