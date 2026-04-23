import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { SimpleBarChart } from "../components/admin/SimpleBarChart";
import {
  aggregateApprovedBilling,
  COLLECTIONS,
  isOrderCompleted,
  sellerUiState,
  tsToDate,
} from "../services/adminFirestore";
import { formatMoney } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BillingRecord, BuyerUser, Order, Seller } from "../types/models";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function AnalyticsPage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [users, setUsers] = useState<BuyerUser[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRecord[]>([]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "sellers"), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    const u2 = onSnapshot(collection(db, "users"), (snap) => {
      const list: BuyerUser[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setUsers(list);
    });
    const u3 = onSnapshot(collection(db, "orders"), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setOrders(list);
    });
    const u4 = onSnapshot(collection(db, COLLECTIONS.billing), (snap) => {
      const list: BillingRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setBillingRows(list);
    });
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  const metrics = useMemo(() => {
    const buyers = users.filter((u) => (u.role ?? "buyer") === "buyer");
    let live = 0;
    let trial = 0;
    let blocked = 0;
    for (const s of sellers) {
      const st = sellerUiState(s);
      if (st === "blocked") blocked += 1;
      else if (st === "trial") trial += 1;
      else if (st === "live") live += 1;
    }
    const t0 = startOfToday().getTime();
    const m0 = startOfMonth().getTime();
    let ordersToday = 0;
    let ordersMonth = 0;
    let revToday = 0;
    let revMonth = 0;
    const sellerRevenue = new Map<string, number>();
    const buyerSpend = new Map<string, number>();
    const buyerOrderCounts = new Map<string, number>();
    const dayBuckets = new Map<string, { orders: number; revenue: number }>();

    for (const o of orders) {
      const ms = orderTimeMs(o);
      const dayKey = new Date(ms).toISOString().slice(0, 10);
      if (ms >= t0) {
        ordersToday += 1;
        if (isOrderCompleted(o.status)) revToday += Number(o.total ?? 0);
      }
      if (ms >= m0) {
        ordersMonth += 1;
        if (isOrderCompleted(o.status)) revMonth += Number(o.total ?? 0);
      }
      const bpOrder = (o.buyerPhone ?? "").trim();
      if (bpOrder) {
        buyerOrderCounts.set(bpOrder, (buyerOrderCounts.get(bpOrder) ?? 0) + 1);
      }
      if (isOrderCompleted(o.status)) {
        const sid = o.sellerId ?? "";
        if (sid) sellerRevenue.set(sid, (sellerRevenue.get(sid) ?? 0) + Number(o.total ?? 0));
        const bp = (o.buyerPhone ?? "").trim();
        if (bp) buyerSpend.set(bp, (buyerSpend.get(bp) ?? 0) + Number(o.total ?? 0));
      }
      const b = dayBuckets.get(dayKey) ?? { orders: 0, revenue: 0 };
      b.orders += 1;
      if (isOrderCompleted(o.status)) b.revenue += Number(o.total ?? 0);
      dayBuckets.set(dayKey, b);
    }

    const last14 = [...dayBuckets.keys()].sort().slice(-14);
    const orderTrend = last14.map((k) => ({ label: k.slice(5), value: dayBuckets.get(k)?.orders ?? 0 }));
    const revenueTrend = last14.map((k) => ({ label: k.slice(5), value: Math.round(dayBuckets.get(k)?.revenue ?? 0) }));

    const topShops = [...sellerRevenue.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, value]) => {
        const name = sellers.find((s) => s.id === id)?.shopName ?? id;
        return { label: name.slice(0, 18), value: Math.round(value) };
      });

    const topBuyers = [...buyerSpend.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([phone, value]) => ({ label: phone.slice(-10), value: Math.round(value) }));

    const newSignups = buyers.filter((u) => {
      const t = tsToDate(u.createdAt as never);
      return t && t >= startOfMonth();
    }).length;

    const billingAgg = aggregateApprovedBilling(billingRows);
    const repeatBuyerPhones = [...buyerOrderCounts.entries()].filter(([, n]) => n > 1).length;

    return {
      totalSellers: sellers.length,
      live,
      trial,
      blocked,
      totalBuyers: buyers.length,
      ordersToday,
      ordersMonth,
      revToday,
      revMonth,
      orderTrend,
      revenueTrend,
      topShops,
      topBuyers,
      newSignups,
      billingApprovedAmount: billingAgg.approvedAmount,
      slotsSoldBilling: billingAgg.slotsSold,
      repeatBuyerPhones,
    };
  }, [sellers, users, orders, billingRows]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="muted">Realtime aggregates from sellers, users, and orders</p>
        </div>
      </header>

      <div className="stat-grid">
        {[
          { label: "Total sellers", value: String(metrics.totalSellers) },
          { label: "Live sellers", value: String(metrics.live) },
          { label: "Trial sellers", value: String(metrics.trial) },
          { label: "Blocked sellers", value: String(metrics.blocked) },
          { label: "Total buyers", value: String(metrics.totalBuyers) },
          { label: "Orders today", value: String(metrics.ordersToday) },
          { label: "Orders this month", value: String(metrics.ordersMonth) },
          { label: "Revenue today", value: formatMoney(metrics.revToday) },
          { label: "Revenue month", value: formatMoney(metrics.revMonth) },
          { label: "New buyer signups (month)", value: String(metrics.newSignups) },
          { label: "Approved billing total (₹)", value: formatMoney(metrics.billingApprovedAmount) },
          { label: "Slots sold (approved billing)", value: String(metrics.slotsSoldBilling) },
          { label: "Repeat buyers (2+ orders)", value: String(metrics.repeatBuyerPhones) },
        ].map((t) => (
          <Card key={t.label} title={t.label}>
            <div className="stat-value" style={{ fontSize: "1.35rem" }}>
              {t.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="split-2" style={{ marginTop: "1rem" }}>
        <Card title="Orders trend (14d)">
          <SimpleBarChart points={metrics.orderTrend} />
        </Card>
        <Card title="Revenue trend (14d)">
          <SimpleBarChart points={metrics.revenueTrend} />
        </Card>
      </div>

      <div className="split-2" style={{ marginTop: "1rem" }}>
        <Card title="Top shops (completed revenue)">
          <SimpleBarChart points={metrics.topShops} />
        </Card>
        <Card title="Top buyers (by phone)">
          <SimpleBarChart points={metrics.topBuyers} />
        </Card>
      </div>
    </div>
  );
}
