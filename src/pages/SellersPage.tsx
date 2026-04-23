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
import { Modal } from "../components/Modal";
import { SellerStatusBadge } from "../components/admin/SellerStatusBadge";
import {
  adminAddSlotsWithOptionalLive,
  adminGoLive,
  adminPutOnTrial,
  adminSuspendSeller,
  backfillMissingShopCodes,
  downloadTextFile,
  isOrderCompleted,
  sellerDisplayLabel,
  sellerOperationalCategory,
  toCsvRow,
} from "../services/adminFirestore";
import { formatMoney, waLink } from "../lib/format";
import { useAdminSession } from "../contexts/AdminSessionContext";
import type { Order, Seller } from "../types/models";

type Filter = "all" | "trial" | "live" | "demo" | "suspended" | "blocked" | "no_slots" | "top";

export function SellersPage() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const { admin } = useAdminSession();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Seller | null>(null);
  const [slotsSeller, setSlotsSeller] = useState<Seller | null>(null);
  const [slotInput, setSlotInput] = useState("10");
  const [slotMode, setSlotMode] = useState<"add" | "remove" | "set">("add");
  const [autoActivateOnSlotAdd, setAutoActivateOnSlotAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  const [goLiveSeller, setGoLiveSeller] = useState<Seller | null>(null);
  const [goLiveSlots, setGoLiveSlots] = useState("10");
  const [goLiveRecharge, setGoLiveRecharge] = useState("");
  const [goLiveNotes, setGoLiveNotes] = useState("");
  const [goLiveImmediate, setGoLiveImmediate] = useState(true);

  const [trialSeller, setTrialSeller] = useState<Seller | null>(null);
  const [trialDaysInput, setTrialDaysInput] = useState("14");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "sellers"), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    const u2 = onSnapshot(collection(db, "orders"), (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setOrders(list);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  const bySeller = useMemo(() => {
    const m = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const sid = o.sellerId;
      if (!sid) continue;
      const cur = m.get(sid) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      if (isOrderCompleted(o.status)) cur.revenue += Number(o.total ?? 0);
      m.set(sid, cur);
    }
    return m;
  }, [orders]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = sellers.slice();

    const matchSearch = (s: Seller) => {
      if (!needle) return true;
      return [s.shopName, s.ownerName, s.phone, s.id, s.shopCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    };

    list = list.filter(matchSearch);

    if (filter === "trial") list = list.filter((s) => sellerOperationalCategory(s) === "trial");
    if (filter === "live") list = list.filter((s) => sellerOperationalCategory(s) === "live");
    if (filter === "demo") list = list.filter((s) => sellerOperationalCategory(s) === "demo");
    if (filter === "suspended") list = list.filter((s) => sellerOperationalCategory(s) === "suspended");
    if (filter === "blocked") list = list.filter((s) => s.isBlocked);
    if (filter === "no_slots") list = list.filter((s) => Number(s.slots ?? 0) <= 0);
    if (filter === "top") {
      list.sort((a, b) => (bySeller.get(b.id)?.revenue ?? 0) - (bySeller.get(a.id)?.revenue ?? 0));
      list = list.slice(0, 25);
    }

    return list;
  }, [sellers, q, filter, bySeller]);

  async function toggleBlock(s: Seller) {
    setBusy(true);
    try {
      await updateDoc(doc(db, "sellers", s.id), { isBlocked: !s.isBlocked });
    } finally {
      setBusy(false);
    }
  }

  async function removeSeller(s: Seller) {
    if (!window.confirm(`Delete seller ${s.shopName ?? s.id}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "sellers", s.id));
    } finally {
      setBusy(false);
    }
  }

  function openGoLive(s: Seller) {
    setGoLiveSeller(s);
    setGoLiveSlots("10");
    setGoLiveRecharge("");
    setGoLiveNotes("");
    setGoLiveImmediate(true);
  }

  async function confirmGoLive() {
    if (!goLiveSeller) return;
    const slots = Math.floor(Number(goLiveSlots));
    if (!Number.isFinite(slots) || slots < 1) {
      window.alert("Slots to add must be at least 1.");
      return;
    }
    setBusy(true);
    try {
      await adminGoLive({
        sellerId: goLiveSeller.id,
        slotsToAdd: slots,
        rechargeAmount: Number(goLiveRecharge) || 0,
        notes: goLiveNotes.trim(),
        startImmediately: goLiveImmediate,
        adminId: admin?.id ?? "",
      });
      setGoLiveSeller(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Go Live failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmTrial() {
    if (!trialSeller) return;
    setBusy(true);
    try {
      await adminPutOnTrial({
        sellerId: trialSeller.id,
        trialDays: trialDaysInput,
      });
      setTrialSeller(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to set trial");
    } finally {
      setBusy(false);
    }
  }

  async function suspendSeller(s: Seller) {
    if (
      !window.confirm(
        `Suspend ${s.shopName ?? s.id}? Login stays allowed; shop should not receive new orders until reactivated.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await adminSuspendSeller(s.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Suspend failed");
    } finally {
      setBusy(false);
    }
  }

  async function applySlots() {
    if (!slotsSeller) return;
    const n = Math.floor(Number(slotInput));
    if (!Number.isFinite(n) || n < 0) {
      window.alert("Enter a valid number.");
      return;
    }
    if (slotMode !== "set" && n <= 0) {
      window.alert("Enter a positive number.");
      return;
    }
    setBusy(true);
    try {
      if (slotMode === "set") {
        await updateDoc(doc(db, "sellers", slotsSeller.id), { slots: Math.max(0, n) });
      } else if (slotMode === "add") {
        await adminAddSlotsWithOptionalLive({
          sellerId: slotsSeller.id,
          slotsToAdd: n,
          autoActivateLive: autoActivateOnSlotAdd,
          adminId: admin?.id ?? "",
          notes: "",
        });
      } else {
        const cur = Number(slotsSeller.slots ?? 0);
        await updateDoc(doc(db, "sellers", slotsSeller.id), {
          slots: Math.max(0, cur - n),
        });
      }
      setSlotsSeller(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Slots update failed");
    } finally {
      setBusy(false);
    }
  }

  function exportAll() {
    const sorted = [...sellers].sort((a, b) =>
      (a.shopName ?? "").localeCompare(b.shopName ?? "", undefined, { sensitivity: "base" })
    );
    const rows = [
      toCsvRow(["Shop Name", "Owner", "Phone", "Shop Code", "Status", "Slots"]),
      ...sorted.map((s) =>
        toCsvRow([
          s.shopName ?? "",
          s.ownerName ?? "",
          s.phone ?? "",
          s.shopCode ?? "",
          sellerDisplayLabel(s),
          String(s.slots ?? 0),
        ])
      ),
    ];
    downloadTextFile("sellers-export.csv", rows.join("\n"));
  }

  async function runBackfillShopCodes() {
    if (
      !window.confirm(
        "Generate unique shop codes for all sellers missing shopCode? Existing codes are not changed."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const n = await backfillMissingShopCodes();
      window.alert(`${n} sellers updated.`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBusy(false);
    }
  }

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "live", label: "Live" },
    { id: "trial", label: "Trial" },
    { id: "demo", label: "Demo" },
    { id: "suspended", label: "Suspended" },
    { id: "blocked", label: "Blocked" },
    { id: "no_slots", label: "No slots" },
    { id: "top", label: "Top revenue" },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Sellers</h1>
          <p className="muted">Operational controls — Go Live, trial, suspend, slots, billing logs.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to={`${base}/create-seller`}>
            Create seller
          </Link>
          <Button variant="ghost" disabled={busy} onClick={() => void runBackfillShopCodes()}>
            Generate Missing Shop Codes
          </Button>
          <Button variant="ghost" onClick={() => exportAll()}>
            Export CSV
          </Button>
        </div>
      </header>

      <div className="toolbar">
        <label className="field toolbar__grow" style={{ marginBottom: 0 }}>
          <span className="muted small">Search</span>
          <input
            className="input"
            placeholder="Phone, shop, owner, seller id, shop code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      <div className="filter-chips" style={{ marginBottom: "1rem" }}>
        {chips.map((c) => (
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
                <th>Shop name</th>
                <th>Owner</th>
                <th>Phone</th>
                <th>Shop code</th>
                <th>Status</th>
                <th>Slots</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const agg = bySeller.get(s.id) ?? { orders: 0, revenue: 0 };
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="cell-strong">{s.shopName ?? "—"}</div>
                    </td>
                    <td>{s.ownerName ?? "—"}</td>
                    <td>{s.phone ?? "—"}</td>
                    <td>
                      {s.shopCode ? (
                        <span className="shop-code-badge">{s.shopCode}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <SellerStatusBadge seller={s} />
                    </td>
                    <td>{String(s.slots ?? 0)}</td>
                    <td>{agg.orders}</td>
                    <td>{formatMoney(agg.revenue)}</td>
                    <td className="actions-cell actions-cell--wrap">
                      <div className="seller-actions">
                        <Link className="btn btn--ghost btn--compact" to={`${base}/seller/${s.id}`}>
                          View
                        </Link>
                        <Link className="btn btn--ghost btn--compact" to={`${base}/seller/${s.id}`}>
                          Edit
                        </Link>
                        <Button
                          variant="ghost"
                          className="btn--compact"
                          onClick={() => {
                            setSlotMode("add");
                            setAutoActivateOnSlotAdd(false);
                            setSlotsSeller(s);
                          }}
                        >
                          Add slots
                        </Button>
                        <Button
                          variant="ghost"
                          className="btn--compact"
                          onClick={() => {
                            setSlotMode("remove");
                            setSlotsSeller(s);
                          }}
                        >
                          Remove slots
                        </Button>
                        <Button variant="live" className="btn--compact" onClick={() => openGoLive(s)} disabled={busy}>
                          Go Live
                        </Button>
                        <Button variant="trial" className="btn--compact" onClick={() => setTrialSeller(s)} disabled={busy}>
                          Trial
                        </Button>
                        <Button variant="suspend" className="btn--compact" onClick={() => void suspendSeller(s)} disabled={busy}>
                          Suspend
                        </Button>
                        <Button variant="danger" className="btn--compact" onClick={() => void toggleBlock(s)} disabled={busy}>
                          {s.isBlocked ? "Unblock" : "Block"}
                        </Button>
                        <Button variant="danger" className="btn--compact" onClick={() => void removeSeller(s)} disabled={busy}>
                          Delete
                        </Button>
                        <Button variant="ghost" className="btn--compact" onClick={() => setDetail(s)}>
                          Raw JSON
                        </Button>
                        <a className="btn btn--ghost btn--compact" href={waLink(s.phone)} target="_blank" rel="noreferrer">
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

      <Modal
        open={!!detail}
        title="Seller document (debug)"
        onClose={() => setDetail(null)}
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? <pre className="json-pre">{JSON.stringify(detail, null, 2)}</pre> : null}
      </Modal>

      <Modal
        open={!!goLiveSeller}
        title={`Go Live — ${goLiveSeller?.shopName ?? ""}`}
        onClose={() => setGoLiveSeller(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGoLiveSeller(null)}>
              Cancel
            </Button>
            <Button variant="live" onClick={() => void confirmGoLive()} disabled={busy}>
              Confirm Go Live
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span>Slots to add (required)</span>
            <input className="input" inputMode="numeric" value={goLiveSlots} onChange={(e) => setGoLiveSlots(e.target.value)} />
          </label>
          <label className="field">
            <span>Recharge amount (optional)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0"
              value={goLiveRecharge}
              onChange={(e) => setGoLiveRecharge(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Notes (optional)</span>
            <textarea className="input input--area" rows={2} value={goLiveNotes} onChange={(e) => setGoLiveNotes(e.target.value)} />
          </label>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={goLiveImmediate} onChange={(e) => setGoLiveImmediate(e.target.checked)} />
            <span>Start immediately (full live activation)</span>
          </label>
          <p className="muted small">
            When unchecked, only <strong>slots</strong> and <strong>wallet balance</strong> update — seller mode stays unchanged.
            When checked, applies live mode, clears trial dominance, writes billing log <code className="code">GO_LIVE</code>.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!trialSeller}
        title={`Put on trial — ${trialSeller?.shopName ?? ""}`}
        onClose={() => setTrialSeller(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrialSeller(null)}>
              Cancel
            </Button>
            <Button variant="trial" onClick={() => void confirmTrial()} disabled={busy}>
              Start trial
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Trial days</span>
          <input className="input" inputMode="numeric" value={trialDaysInput} onChange={(e) => setTrialDaysInput(e.target.value)} />
        </label>
        <p className="muted small">Starts now · sets sellerMode freeTrial and isLive false.</p>
      </Modal>

      <Modal
        open={!!slotsSeller}
        title={`Slots — ${slotsSeller?.shopName ?? ""}`}
        onClose={() => setSlotsSeller(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlotsSeller(null)}>
              Cancel
            </Button>
            <Button onClick={() => void applySlots()} disabled={busy}>
              Apply
            </Button>
          </>
        }
      >
        <p className="muted small">
          Choose mode below. <strong>Add</strong> can optionally run full Go Live (cyan path) without opening the Go Live modal.
        </p>
        <label className="field">
          <span>Mode</span>
          <select className="input" value={slotMode} onChange={(e) => setSlotMode(e.target.value as "add" | "remove" | "set")}>
            <option value="add">Add slots</option>
            <option value="remove">Remove slots</option>
            <option value="set">Set exact slots</option>
          </select>
        </label>
        <label className="field">
          <span>{slotMode === "set" ? "Exact slot count" : "Number of slots"}</span>
          <input className="input" value={slotInput} onChange={(e) => setSlotInput(e.target.value)} inputMode="numeric" />
        </label>
        {slotMode === "add" ? (
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={autoActivateOnSlotAdd} onChange={(e) => setAutoActivateOnSlotAdd(e.target.checked)} />
            <span>Auto activate live if slots added (full Go Live)</span>
          </label>
        ) : null}
      </Modal>
    </div>
  );
}
