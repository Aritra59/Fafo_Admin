import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../../firebase";
import { Card } from "../Card";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { useAdminSession } from "../../contexts/AdminSessionContext";
import {
  adminManualWalletTopup,
  COLLECTIONS,
  isTrialActive,
  sellerDisplayLabel,
  SETTINGS_GLOBAL_ID,
  tsToDate,
} from "../../services/adminFirestore";
import { formatDate, formatMoney } from "../../lib/format";
import type { BillingLogEntry, BillingRecord, GlobalSettings, Seller } from "../../types/models";

const MS_DAY = 86400000;
const LOW_WALLET_ABSOLUTE = 250;

function logTimeMs(log: BillingLogEntry): number {
  return tsToDate(log.createdAt as never)?.getTime() ?? 0;
}

function isRechargeLog(log: BillingLogEntry): boolean {
  return Number(log.amountAdded ?? 0) > 0;
}

function isDeductionLikeLog(log: BillingLogEntry): boolean {
  const amt = Number(log.amountAdded ?? 0);
  if (amt < 0) return true;
  const a = (log.action ?? "").toUpperCase();
  return /DEDUCT|DEBIT|FEE|WITHDRAW|BURN|ORDER_FEE|SLOT_COST|SLOT_DEDUCT|WALLET_DEBIT/.test(a);
}

export type SellerBillingAnalyticsRow = {
  seller: Seller;
  wallet: number;
  totalRecharges: number;
  totalDeductions: number;
  dailyCost: number;
  dailyCostEstimated: boolean;
  daysLeft: number | null;
  lastRecharge: Date | null;
  rechargeCount: number;
  statusLabel: string;
  alertLowBalance: boolean;
  alertPostTrialNoRecharge: boolean;
  alertUnderTwoDays: boolean;
};

function buildRows(
  sellers: Seller[],
  logs: BillingLogEntry[],
  billingRows: BillingRecord[],
  slotRatePerDay: number
): SellerBillingAnalyticsRow[] {
  const now = Date.now();
  const sevenAgo = now - 7 * MS_DAY;
  const bySeller = new Map<string, BillingLogEntry[]>();
  for (const l of logs) {
    const sid = (l.sellerId ?? "").trim();
    if (!sid) continue;
    const arr = bySeller.get(sid) ?? [];
    arr.push(l);
    bySeller.set(sid, arr);
  }

  return sellers.map((seller) => {
    const list = bySeller.get(seller.id) ?? [];
    let totalRecharges = 0;
    let totalDeductions = 0;
    let rechargeCount = 0;
    let lastRecharge: Date | null = null;
    let sumDeductions7d = 0;

    for (const l of list) {
      const amt = Number(l.amountAdded ?? 0);
      const t = logTimeMs(l);
      if (isRechargeLog(l)) {
        totalRecharges += amt;
        rechargeCount += 1;
        const d = tsToDate(l.createdAt as never);
        if (d && (!lastRecharge || d > lastRecharge)) lastRecharge = d;
      }
      if (isDeductionLikeLog(l)) {
        totalDeductions += Math.abs(amt);
        if (t >= sevenAgo) sumDeductions7d += Math.abs(amt);
      }
    }

    for (const b of billingRows) {
      if ((b.sellerId ?? "") !== seller.id) continue;
      if ((b.status ?? "").toLowerCase() !== "approved") continue;
      const amt = Number(b.amount ?? 0);
      if (amt <= 0) continue;
      totalRecharges += amt;
      rechargeCount += 1;
      const d = tsToDate(b.processedAt as never) ?? tsToDate(b.createdAt as never);
      if (d && (!lastRecharge || d > lastRecharge)) lastRecharge = d;
    }

    const dailyFromLogs = sumDeductions7d / 7;
    const liveish =
      seller.isLive === true &&
      Number(seller.slots ?? 0) > 0 &&
      !isTrialActive(seller) &&
      !seller.isBlocked;
    const estimatedDaily =
      dailyFromLogs <= 0 && liveish && slotRatePerDay > 0 ? Math.max(0, slotRatePerDay) : 0;
    const dailyCost = dailyFromLogs > 0 ? dailyFromLogs : estimatedDaily;
    const dailyCostEstimated = dailyFromLogs <= 0 && estimatedDaily > 0;

    const wallet = Number(seller.currentAvailableBalance ?? seller.walletBalance ?? 0);
    const daysLeft =
      dailyCost > 0 && Number.isFinite(wallet / dailyCost) ? Math.floor(wallet / dailyCost) : null;

    const statusLabel = sellerDisplayLabel(seller);
    const trialEnd = tsToDate(seller.trialEnd as never);
    const trialOver = Boolean(trialEnd && trialEnd.getTime() < now);
    const lastRechargeMs = lastRecharge?.getTime() ?? 0;
    const trialEndMs = trialEnd?.getTime() ?? 0;
    const postTrialNoRecharge =
      trialOver &&
      (lastRecharge == null || lastRechargeMs <= trialEndMs) &&
      !isTrialActive(seller) &&
      (seller.isLive === true || Number(seller.slots ?? 0) > 0) &&
      !seller.isBlocked;

    const underTwoDays = dailyCost > 0 && wallet / dailyCost < 2;
    const lowBalance =
      dailyCost <= 0 &&
      wallet < LOW_WALLET_ABSOLUTE &&
      !isTrialActive(seller) &&
      seller.isLive === true &&
      !seller.isBlocked;

    return {
      seller,
      wallet,
      totalRecharges,
      totalDeductions,
      dailyCost,
      dailyCostEstimated,
      daysLeft,
      lastRecharge,
      rechargeCount,
      statusLabel,
      alertLowBalance: Boolean(lowBalance),
      alertPostTrialNoRecharge: Boolean(postTrialNoRecharge && seller.isLive !== false && !seller.isBlocked),
      alertUnderTwoDays: Boolean(underTwoDays),
    };
  });
}

export function BillingRechargeMonitor() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const { admin } = useAdminSession();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [logs, setLogs] = useState<BillingLogEntry[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRecord[]>([]);
  const [slotRatePerDay, setSlotRatePerDay] = useState(0);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [topup, setTopup] = useState<null | { seller: Seller }>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.billing), (snap) => {
      const list: BillingRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setBillingRows(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.billingLogs), (snap) => {
      const list: BillingLogEntry[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => logTimeMs(b) - logTimeMs(a));
      setLogs(list.slice(0, 4000));
    });
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, COLLECTIONS.settings, SETTINGS_GLOBAL_ID), (snap) => {
      const d = (snap.exists() ? snap.data() : {}) as GlobalSettings;
      setSlotRatePerDay(Math.max(0, Number(d.slotRatePerDay ?? 0)));
    });
  }, []);

  const rows = useMemo(
    () => buildRows(sellers, logs, billingRows, slotRatePerDay),
    [sellers, logs, billingRows, slotRatePerDay]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [r.seller.shopName, r.seller.shopCode, r.seller.ownerName, r.seller.phone, r.seller.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = a.daysLeft ?? 9999;
      const db = b.daysLeft ?? 9999;
      if (da !== db) return da - db;
      return a.wallet - b.wallet;
    });
  }, [filtered]);

  async function submitTopup() {
    if (!topup) return;
    const amt = Number(topupAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      window.alert("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await adminManualWalletTopup({
        sellerId: topup.seller.id,
        amount: amt,
        adminId: admin?.id ?? "",
        notes: topupNote.trim() || "Admin manual wallet top-up",
      });
      setTopup(null);
      setTopupAmount("");
      setTopupNote("");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Top-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Seller recharge &amp; wallet monitor">
        <p className="muted small" style={{ marginTop: 0 }}>
          Daily cost uses the <strong>7-day average</strong> of deduction-like rows in <span className="mono">billingLogs</span>{" "}
          (negative <span className="mono">amountAdded</span> or matching action keywords). If none, live sellers with slots use global{" "}
          <strong>slot rate / day</strong> as an estimate. Days left = wallet ÷ daily cost. Total recharges include positive{" "}
          <span className="mono">billingLogs</span> credits plus <strong>approved</strong> amounts from the <span className="mono">billing</span>{" "}
          queue.
        </p>
        <div className="category-toolbar">
          <label className="field field--inline-grow" style={{ marginBottom: 0 }}>
            <span className="muted small">Search sellers</span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Shop, code, phone…"
            />
          </label>
        </div>
        <div className="billing-alert-legend muted small">
          <span className="billing-legend-dot billing-legend-dot--danger" /> Low balance / &lt; 2 days runway
          <span className="billing-legend-dot billing-legend-dot--warn" style={{ marginLeft: "1rem" }} /> Live after trial, no recharge logged
        </div>
        <div className="table-wrap">
          <table className="data-table data-table--enterprise data-table--dense">
            <thead>
              <tr>
                <th>Seller</th>
                <th>Shop code</th>
                <th className="numeric">Wallet</th>
                <th className="numeric">Daily cost</th>
                <th className="numeric">Days left</th>
                <th>Last recharge</th>
                <th>Status</th>
                <th className="numeric muted small">Σ+ / Σ−</th>
                <th className="actions-cell" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const risk = r.alertLowBalance || r.alertUnderTwoDays;
                const rowClass = [risk ? "billing-row--danger" : "", r.alertPostTrialNoRecharge ? "billing-row--warn" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={r.seller.id} className={rowClass || undefined}>
                    <td>
                      <Link className="link-inline cell-strong" to={`${base}/seller/${r.seller.id}`}>
                        {r.seller.shopName ?? r.seller.ownerName ?? r.seller.id}
                      </Link>
                      <div className="muted mono small">{r.seller.id}</div>
                    </td>
                    <td className="mono small">{r.seller.shopCode ?? "—"}</td>
                    <td className="numeric cell-strong">{formatMoney(r.wallet)}</td>
                    <td className="numeric small">
                      {formatMoney(r.dailyCost)}
                      {r.dailyCostEstimated ? <span className="muted"> *</span> : null}
                    </td>
                    <td className="numeric">
                      {r.daysLeft == null ? "—" : <span className={r.daysLeft < 2 ? "text-warn-strong" : undefined}>{r.daysLeft}</span>}
                    </td>
                    <td className="muted small">{r.lastRecharge ? formatDate(r.lastRecharge as never) : "—"}</td>
                    <td>
                      <span className="pill pill--muted">{r.statusLabel}</span>
                      <div className="muted small">n={r.rechargeCount}</div>
                    </td>
                    <td className="numeric muted small">
                      <div>{formatMoney(r.totalRecharges)}</div>
                      <div>−{formatMoney(r.totalDeductions)}</div>
                    </td>
                    <td className="actions-cell">
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        onClick={() => {
                          setTopup({ seller: r.seller });
                          setTopupAmount("");
                          setTopupNote("");
                        }}
                      >
                        Top up
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">* Estimated from global slot rate / day when no 7d deductions in logs.</p>
      </Card>

      <Modal
        open={!!topup}
        title={topup ? `Wallet top-up — ${topup.seller.shopName ?? topup.seller.id}` : "Top-up"}
        onClose={() => !busy && setTopup(null)}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setTopup(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void submitTopup()}>
              Credit wallet
            </Button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Credits both <span className="mono">currentAvailableBalance</span> and <span className="mono">walletBalance</span>. A{" "}
          <span className="mono">billingLogs</span> row is written with action <span className="mono">ADMIN_WALLET_TOPUP</span>.
        </p>
        <label className="field">
          <span>Amount (INR)</span>
          <input className="input" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input className="input" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} placeholder="Reason for audit" />
        </label>
      </Modal>
    </>
  );
}
