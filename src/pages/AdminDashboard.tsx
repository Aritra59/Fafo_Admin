import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { SimpleBarChart } from "../components/admin/SimpleBarChart";
import {
  aggregateApprovedBilling,
  buildTrendMetrics,
  COLLECTIONS,
  isOrderCompleted,
  sellerOperationalCategory,
  tsToDate,
} from "../services/adminFirestore";
import { formatMoney } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BillingRecord, Order, Seller } from "../types/models";

function trialEndsWithinDays(seller: Seller, days: number): boolean {
  const end = tsToDate(seller.trialEnd as never);
  if (!end) return false;
  const now = Date.now();
  if (end.getTime() <= now) return false;
  return end.getTime() - now <= days * 86400000;
}

export function AdminDashboard() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRecord[]>([]);

  useEffect(() => {
    const unsubOrders = onSnapshot(collection(db, COLLECTIONS.orders), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setOrders(list);
    });
    const unsubSellers = onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    const unsubBilling = onSnapshot(collection(db, COLLECTIONS.billing), (snap) => {
      const list: BillingRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setBillingRows(list);
    });

    return () => {
      unsubOrders();
      unsubSellers();
      unsubBilling();
    };
  }, []);

  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let activeSellers = 0;
    let trialsEnding = 0;
    let blockedSellers = 0;
    for (const s of sellers) {
      if (s.isBlocked) blockedSellers += 1;
      if (sellerOperationalCategory(s) === "live") activeSellers += 1;
      if (sellerOperationalCategory(s) === "trial" && trialEndsWithinDays(s, 7)) trialsEnding += 1;
    }

    let ordersToday = 0;
    let gmv = 0;
    for (const o of orders) {
      const ms = orderTimeMs(o);
      if (ms >= startOfToday.getTime()) ordersToday += 1;
      if (isOrderCompleted(o.status)) gmv += Number(o.total ?? 0);
    }

    const pendingBilling = billingRows.filter((r) => (r.status ?? "pending").toLowerCase() === "pending").length;
    const billingAgg = aggregateApprovedBilling(billingRows);
    const trends = buildTrendMetrics(orders, sellers);

    return {
      gmv,
      orderCount: orders.length,
      sellerCount: sellers.length,
      activeSellers,
      trialsEnding,
      ordersToday,
      pendingBilling,
      blockedSellers,
      billingAgg,
      trends,
    };
  }, [orders, sellers, billingRows]);

  const tiles = [
    { label: "Total sellers", value: String(stats.sellerCount) },
    { label: "Active sellers (live)", value: String(stats.activeSellers) },
    { label: "Trials ending (7 days)", value: String(stats.trialsEnding) },
    { label: "Orders today", value: String(stats.ordersToday) },
    { label: "Total GMV (completed)", value: formatMoney(stats.gmv) },
    { label: "Pending billing", value: String(stats.pendingBilling) },
    { label: "Blocked sellers", value: String(stats.blockedSellers) },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted">Live overview of shops, orders, and billing</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to={`${base}/analytics`}>
            Analytics
          </Link>
          <Link className="btn btn--ghost" to={`${base}/billing`}>
            Billing
          </Link>
          <Link className="btn btn--ghost" to={`${base}/sellers`}>
            Sellers
          </Link>
          <Link className="btn btn--ghost" to={`${base}/orders`}>
            Orders
          </Link>
        </div>
      </header>
      <div className="stat-grid">
        {tiles.map((t) => (
          <Card key={t.label} title={t.label}>
            <div className="stat-value">{t.value}</div>
          </Card>
        ))}
      </div>

      <p className="muted small" style={{ marginTop: "1rem" }}>
        Approved billing packages (slots sold): {String(stats.billingAgg.slotsSold)} · Repeat buyers (2+ orders):{" "}
        {String(stats.trends.repeatBuyers)}
      </p>

      <div className="split-2" style={{ marginTop: "1rem" }}>
        <Card title="Orders trend (14 days)">
          <SimpleBarChart points={stats.trends.orderTrend} />
        </Card>
        <Card title="Revenue trend (14 days, completed)">
          <SimpleBarChart points={stats.trends.revenueTrend} />
        </Card>
      </div>

      <div className="split-2" style={{ marginTop: "1rem" }}>
        <Card title="Top shops">
          <SimpleBarChart points={stats.trends.topShops} />
        </Card>
        <Card title="Top buyers">
          <SimpleBarChart points={stats.trends.topBuyers} />
        </Card>
      </div>
    </div>
  );
}
