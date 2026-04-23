import { useEffect, useMemo, useState } from "react";
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
import { Modal } from "../components/Modal";
import { formatMoney, formatDate, summarizeItems } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { Order, Seller } from "../types/models";

type Filter =
  | "all"
  | "today"
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

const STATUS_OPTIONS = ["pending", "preparing", "ready", "completed", "cancelled", "delivered", "paid"];

function normStatus(s: string | undefined): string {
  return (s ?? "").toLowerCase();
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sellerFilter, setSellerFilter] = useState("");
  const [buyerQ, setBuyerQ] = useState("");
  const [invoice, setInvoice] = useState<Order | null>(null);
  const [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [refundNote, setRefundNote] = useState("");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "orders"), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => orderTimeMs(b) - orderTimeMs(a));
      setOrders(list);
    });
    const u2 = onSnapshot(collection(db, "sellers"), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  const sellerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sellers) {
      m.set(s.id, s.shopName ?? s.ownerName ?? s.id);
    }
    return m;
  }, [sellers]);

  const startToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const filtered = useMemo(() => {
    const bq = buyerQ.trim().toLowerCase();
    return orders.filter((o) => {
      const st = normStatus(o.status);
      if (filter === "today" && orderTimeMs(o) < startToday) return false;
      if (filter === "pending" && !["pending", "placed", "new", "received"].includes(st)) return false;
      if (filter === "preparing" && st !== "preparing") return false;
      if (filter === "ready" && st !== "ready") return false;
      if (filter === "completed" && !["completed", "delivered", "paid", "done"].includes(st)) return false;
      if (filter === "cancelled" && !["cancelled", "canceled", "refunded"].includes(st)) return false;
      if (sellerFilter && o.sellerId !== sellerFilter) return false;
      if (bq) {
        const phone = (o.buyerPhone ?? "").toLowerCase();
        const name = (o.buyerName ?? "").toLowerCase();
        if (!phone.includes(bq) && !name.includes(bq)) return false;
      }
      return true;
    });
  }, [orders, filter, startToday, sellerFilter, buyerQ]);

  async function setStatus(o: Order, status: string) {
    setBusy(true);
    try {
      await updateDoc(doc(db, "orders", o.id), { status });
    } finally {
      setBusy(false);
    }
  }

  async function saveRefund() {
    if (!refundOrder) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "orders", refundOrder.id), {
        refundNote: refundNote.trim(),
        status: "cancelled",
      });
      setRefundOrder(null);
      setRefundNote("");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrder(o: Order) {
    if (!window.confirm(`Delete order ${o.id}?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "orders", o.id));
    } finally {
      setBusy(false);
    }
  }

  const filterChips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "today", label: "Today" },
    { id: "pending", label: "Pending" },
    { id: "preparing", label: "Preparing" },
    { id: "ready", label: "Ready" },
    { id: "completed", label: "Completed" },
    { id: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="muted">Filter, change status, refunds, and cleanup test orders.</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="field toolbar__grow" style={{ marginBottom: 0 }}>
          <span className="muted small">Buyer phone / name</span>
          <input className="input" value={buyerQ} onChange={(e) => setBuyerQ(e.target.value)} placeholder="Search buyer" />
        </label>
        <label className="field" style={{ marginBottom: 0, minWidth: "200px" }}>
          <span className="muted small">Seller</span>
          <select className="input" value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)}>
            <option value="">All sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shopName ?? s.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="filter-chips" style={{ marginBottom: "1rem" }}>
        {filterChips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`filter-chip${filter === c.id ? " filter-chip--on" : ""}`}
            onClick={() => setFilter(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Created</th>
                <th>Seller</th>
                <th>Buyer</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Pay</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td className="mono small">{o.id}</td>
                  <td className="muted small">{formatDate(o.createdAt as never)}</td>
                  <td>{sellerName.get(o.sellerId ?? "") ?? o.sellerId ?? "—"}</td>
                  <td>
                    <div>{o.buyerName ?? "—"}</div>
                    <div className="muted small">{o.buyerPhone ?? "—"}</div>
                  </td>
                  <td className="cell-clamp" title={summarizeItems(o.items as unknown[])}>
                    {summarizeItems(o.items as unknown[])}
                  </td>
                  <td>{formatMoney(Number(o.total))}</td>
                  <td>{o.paymentMode ?? "—"}</td>
                  <td>
                    <select
                      className="input"
                      style={{ padding: "0.35rem 0.5rem", minWidth: "120px" }}
                      value={normStatus(o.status) || "pending"}
                      disabled={busy}
                      onChange={(e) => void setStatus(o, e.target.value)}
                    >
                      {(() => {
                        const val = normStatus(o.status) || "pending";
                        const opts = [...STATUS_OPTIONS];
                        if (val && !opts.includes(val)) opts.unshift(val);
                        return opts.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ));
                      })()}
                    </select>
                  </td>
                  <td className="actions-cell">
                    <div className="btn-row">
                      <Button variant="ghost" disabled={busy} onClick={() => setInvoice(o)}>
                        Invoice
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRefundOrder(o);
                          setRefundNote(o.refundNote ?? "");
                        }}
                      >
                        Refund
                      </Button>
                      <Button variant="danger" disabled={busy} onClick={() => void deleteOrder(o)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!invoice}
        title={`Order ${invoice?.id ?? ""}`}
        onClose={() => setInvoice(null)}
        footer={
          <Button variant="ghost" onClick={() => setInvoice(null)}>
            Close
          </Button>
        }
      >
        {invoice ? (
          <div className="stack">
            <div className="kv-grid">
              <div className="kv">
                <div className="kv__k">Seller</div>
                <div className="kv__v">{sellerName.get(invoice.sellerId ?? "") ?? invoice.sellerId}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Buyer</div>
                <div className="kv__v">
                  {invoice.buyerName ?? "—"} / {invoice.buyerPhone ?? "—"}
                </div>
              </div>
              <div className="kv">
                <div className="kv__k">Total</div>
                <div className="kv__v">{formatMoney(Number(invoice.total))}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Payment</div>
                <div className="kv__v">{invoice.paymentMode ?? "—"}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Status</div>
                <div className="kv__v">{invoice.status ?? "—"}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Refund note</div>
                <div className="kv__v">{invoice.refundNote ?? "—"}</div>
              </div>
            </div>
            <pre className="json-pre">{JSON.stringify(invoice, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!refundOrder}
        title="Refund / cancel"
        onClose={() => setRefundOrder(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRefundOrder(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveRefund()} disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <p className="muted small">Sets status to cancelled and stores a refund note for records.</p>
        <label className="field">
          <span>Note</span>
          <textarea className="input input--area" rows={3} value={refundNote} onChange={(e) => setRefundNote(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
