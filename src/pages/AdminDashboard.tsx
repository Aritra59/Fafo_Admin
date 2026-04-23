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
} from "../services/adminFirestore";
import { formatMoney } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BillingRecord, Order, Seller } from "../types/models";

export function AdminDashboard() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [buyerCount, setBuyerCount] = useState(0);
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
    const unsubUsers = onSnapshot(collection(db, COLLECTIONS.users), (snap) => {
      let n = 0;
      snap.forEach((d) => {
        const role = (d.data() as DocumentData).role as string | undefined;
        if (!role || role === "buyer") n += 1;
      });
      setBuyerCount(n);
    });
    const unsubBilling = onSnapshot(collection(db, COLLECTIONS.billing), (snap) => {
      const list: BillingRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setBillingRows(list);
    });

    return () => {
      unsubOrders();
      unsubSellers();
      unsubUsers();
      unsubBilling();
    };
  }, []);

  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let liveSellers = 0;
    let trialSellers = 0;
    let demoSellers = 0;
    let suspendedSellers = 0;
    let blockedSellers = 0;
    for (const s of sellers) {
      const c = sellerOperationalCategory(s);
      if (c === "blocked") blockedSellers += 1;
      else if (c === "suspended") suspendedSellers += 1;
      else if (c === "live") liveSellers += 1;
      else if (c === "trial") trialSellers += 1;
      else demoSellers += 1;
    }

    let ordersToday = 0;
    let ordersMonth = 0;
    let revToday = 0;
    let revMonth = 0;
    let revenueAll = 0;

    for (const o of orders) {
      const ms = orderTimeMs(o);
      if (isOrderCompleted(o.status)) revenueAll += Number(o.total ?? 0);
      if (ms >= startOfToday.getTime()) {
        ordersToday += 1;
        if (isOrderCompleted(o.status)) revToday += Number(o.total ?? 0);
      }
      if (ms >= startOfMonth.getTime()) {
        ordersMonth += 1;
        if (isOrderCompleted(o.status)) revMonth += Number(o.total ?? 0);
      }
    }

    const pendingBilling = billingRows.filter((r) => (r.status ?? "pending").toLowerCase() === "pending").length;
    const billingAgg = aggregateApprovedBilling(billingRows);
    const trends = buildTrendMetrics(orders, sellers);

    return {
      revenueAll,
      orderCount: orders.length,
      sellerCount: sellers.length,
      liveSellers,
      trialSellers,
      demoSellers,
      suspendedSellers,
      blockedSellers,
      buyerCount,
      ordersToday,
      ordersMonth,
      revToday,
      revMonth,
      pendingBilling,
      billingAgg,
      trends,
    };
  }, [orders, sellers, buyerCount, billingRows]);

  const tiles = [
    { label: "Total sellers", value: String(stats.sellerCount) },
    { label: "Live sellers", value: String(stats.liveSellers) },
    { label: "Trial sellers", value: String(stats.trialSellers) },
    { label: "Demo sellers", value: String(stats.demoSellers) },
    { label: "Suspended sellers", value: String(stats.suspendedSellers) },
    { label: "Blocked sellers", value: String(stats.blockedSellers) },
    { label: "Total buyers", value: String(stats.buyerCount) },
    { label: "Orders today", value: String(stats.ordersToday) },
    { label: "Orders this month", value: String(stats.ordersMonth) },
    { label: "Revenue today", value: formatMoney(stats.revToday) },
    { label: "Revenue total", value: formatMoney(stats.revenueAll) },
    { label: "Pending billing requests", value: String(stats.pendingBilling) },
    { label: "Slots sold (approved billing)", value: String(stats.billingAgg.slotsSold) },
    { label: "Repeat buyers (2+ orders)", value: String(stats.trends.repeatBuyers) },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted">Realtime totals — orders, sellers, buyers, billing</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to={`${base}/analytics`}>
            Open analytics
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
