import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { SellerStatusBadge } from "../components/admin/SellerStatusBadge";
import { SimpleBarChart } from "../components/admin/SimpleBarChart";
import {
  COLLECTIONS,
  deleteSellerOrders,
  deleteSellerProducts,
  deleteStorageFileIfUrl,
  downloadTextFile,
  generateUniqueShopCode,
  isOrderCancelled,
  isOrderCompleted,
  isOrderPending,
  isTrialActive,
  sellerUiState,
  toCsvRow,
  tsToDate,
} from "../services/adminFirestore";
import { formatMoney, formatDate, summarizeItems, waLink, waMessageLink } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { Order, OrderItem, Seller } from "../types/models";

function itemLabel(it: OrderItem): string {
  return String(it.name ?? it.title ?? "Item");
}

export function SellerDetail() {
  const { appName, sellerId } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const navigate = useNavigate();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [slotModal, setSlotModal] = useState(false);
  const [slotDelta, setSlotDelta] = useState("5");
  const [editField, setEditField] = useState<null | { key: string; label: string; value: string; multiline?: boolean }>(
    null
  );
  const [extendDays, setExtendDays] = useState("7");
  const [ovEnabled, setOvEnabled] = useState(false);
  const [ovTrial, setOvTrial] = useState("");
  const [ovSlotRate, setOvSlotRate] = useState("");
  const [ovFee, setOvFee] = useState("");
  const [ovPresetsJson, setOvPresetsJson] = useState("[]");
  const [resetShopCodeOpen, setResetShopCodeOpen] = useState(false);

  useEffect(() => {
    if (!seller) return;
    setOvEnabled(Boolean(seller.pricingOverrideEnabled));
    setOvTrial(seller.overrideTrialDays != null ? String(seller.overrideTrialDays) : "");
    setOvSlotRate(seller.overrideSlotRatePerDay != null ? String(seller.overrideSlotRatePerDay) : "");
    setOvFee(seller.overrideOrderFeePercent != null ? String(seller.overrideOrderFeePercent) : "");
    setOvPresetsJson(JSON.stringify(seller.overridePresetAmounts ?? [], null, 2));
  }, [seller]);

  useEffect(() => {
    if (!sellerId) return;
    return onSnapshot(doc(db, COLLECTIONS.sellers, sellerId), (snap) => {
      if (!snap.exists()) {
        setSeller(null);
        return;
      }
      setSeller({ id: snap.id, ...(snap.data() as DocumentData) });
    });
  }, [sellerId]);

  useEffect(() => {
    if (!sellerId) return;
    const q = query(collection(db, COLLECTIONS.orders), where("sellerId", "==", sellerId));
    return onSnapshot(q, (snap) => {
      const list: Order[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => orderTimeMs(b) - orderTimeMs(a));
      setOrders(list);
    });
  }, [sellerId]);

  const stats = useMemo(() => {
    const list = orders;
    let pending = 0;
    let completed = 0;
    let cancelled = 0;
    let revenue = 0;
    let todayRev = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const productCounts = new Map<string, number>();
    const buyerCounts = new Map<string, number>();

    for (const o of list) {
      if (isOrderPending(o.status)) pending += 1;
      if (isOrderCompleted(o.status)) {
        completed += 1;
        const amt = Number(o.total ?? 0);
        revenue += amt;
        const t = tsToDate(o.createdAt as never);
        if (t && t >= startOfToday) todayRev += amt;
      }
      if (isOrderCancelled(o.status)) cancelled += 1;
      const bp = (o.buyerPhone ?? "").trim();
      if (bp) buyerCounts.set(bp, (buyerCounts.get(bp) ?? 0) + 1);
      for (const it of o.items ?? []) {
        const label = itemLabel(it as OrderItem);
        productCounts.set(label, (productCounts.get(label) ?? 0) + 1);
      }
    }

    const topProducts = [...productCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));

    const repeatBuyers = [...buyerCounts.entries()].filter(([, n]) => n > 1).length;

    return { pending, completed, cancelled, revenue, todayRev, topProducts, repeatBuyers, orderCount: list.length };
  }, [orders]);

  async function patchSeller(patch: Record<string, unknown>) {
    if (!sellerId) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), patch);
    } finally {
      setBusy(false);
    }
  }

  async function savePricingOverrides() {
    let presets: number[] = [];
    try {
      const parsed = JSON.parse(ovPresetsJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not array");
      presets = parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0);
    } catch {
      window.alert("Preset amounts must be a JSON array of numbers, e.g. [500, 1000]");
      return;
    }
    const patch: Record<string, unknown> = {
      pricingOverrideEnabled: ovEnabled,
      overrideTrialDays: ovTrial.trim() === "" ? deleteField() : Math.max(1, Math.floor(Number(ovTrial) || 1)),
      overrideSlotRatePerDay: ovSlotRate.trim() === "" ? deleteField() : Math.max(0, Number(ovSlotRate) || 0),
      overrideOrderFeePercent: ovFee.trim() === "" ? deleteField() : Math.max(0, Number(ovFee) || 0),
      overridePresetAmounts: presets.length ? presets : deleteField(),
    };
    await patchSeller(patch);
  }

  async function applySlots(delta: number, mode: "add" | "set") {
    if (!sellerId) return;
    setBusy(true);
    try {
      if (mode === "set") {
        const v = Math.max(0, Math.floor(delta));
        await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), { slots: v });
      } else {
        const cur = Number(seller?.slots ?? 0);
        const next = Math.max(0, cur + delta);
        await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), {
          slots: next,
          ...(delta > 0 ? { isLive: true } : {}),
        });
      }
      setSlotModal(false);
    } finally {
      setBusy(false);
    }
  }

  async function onUploadShopImage(file: File) {
    if (!sellerId || !seller) return;
    setBusy(true);
    try {
      if (seller.shopImageUrl) await deleteStorageFileIfUrl(seller.shopImageUrl);
      const path = `shops/${sellerId}/shop-${Date.now()}-${file.name.replace(/\s/g, "_")}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), { shopImageUrl: url });
    } finally {
      setBusy(false);
    }
  }

  async function onUploadQr(file: File) {
    if (!sellerId || !seller) return;
    setBusy(true);
    try {
      if (seller.qrImageUrl) await deleteStorageFileIfUrl(seller.qrImageUrl);
      const path = `shops/${sellerId}/qr-${Date.now()}-${file.name.replace(/\s/g, "_")}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), { qrImageUrl: url });
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(field: "shopImageUrl" | "qrImageUrl") {
    if (!sellerId || !seller?.[field]) return;
    setBusy(true);
    try {
      await deleteStorageFileIfUrl(seller[field]);
      await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), { [field]: null });
    } finally {
      setBusy(false);
    }
  }

  async function performResetShopCode() {
    if (!sellerId || !seller) return;
    setBusy(true);
    try {
      const code = await generateUniqueShopCode(seller.shopName ?? "");
      await patchSeller({ shopCode: code });
      setResetShopCodeOpen(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  function shopCodeWhatsAppHref(): string {
    if (!seller) return "#";
    const lines = [
      "Your shop login details:",
      `Shop code: ${seller.shopCode ?? ""}`,
      `Phone: ${seller.phone ?? ""}`,
    ];
    if (seller.password) lines.push(`Password: ${seller.password}`);
    lines.push("Sign in with shop code + password in the seller app.");
    return waMessageLink(seller.phone, lines.join("\n"));
  }

  async function extendTrial() {
    const days = Math.max(1, Math.floor(Number(extendDays) || 7));
    if (!seller) return;
    const base = tsToDate(seller.trialEnd as never) ?? new Date();
    const next = new Date(base.getTime() + days * 86400000);
    await patchSeller({ trialEnd: Timestamp.fromDate(next) });
  }

  function exportReport() {
    if (!seller) return;
    const rows = [
      toCsvRow(["Seller ID", "Shop", "Owner", "Phone", "Shop code", "Orders", "Revenue"]),
      toCsvRow([
        seller.id,
        seller.shopName ?? "",
        seller.ownerName ?? "",
        seller.phone ?? "",
        seller.shopCode ?? "",
        stats.orderCount,
        stats.revenue,
      ]),
    ];
    downloadTextFile(`seller-${seller.id}.csv`, rows.join("\n"));
  }

  async function deleteAccount(opts: { products: boolean; orders: boolean }) {
    if (!sellerId || !seller) return;
    if (!window.confirm("This permanently deletes data. Continue?")) return;
    setBusy(true);
    try {
      if (opts.products) await deleteSellerProducts(sellerId);
      if (opts.orders) await deleteSellerOrders(sellerId);
      await deleteDoc(doc(db, COLLECTIONS.sellers, sellerId));
      try {
        await deleteDoc(doc(db, COLLECTIONS.users, sellerId));
      } catch {
        /* optional mirror */
      }
      navigate(`${base}/sellers`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllProducts() {
    if (!sellerId) return;
    if (!window.confirm("Delete ALL products for this seller?")) return;
    setBusy(true);
    try {
      await deleteSellerProducts(sellerId);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllOrders() {
    if (!sellerId) return;
    if (!window.confirm("Delete ALL orders for this seller?")) return;
    setBusy(true);
    try {
      await deleteSellerOrders(sellerId);
    } finally {
      setBusy(false);
    }
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editField) return;
    const key = editField.key;
    let v: unknown = editField.value;
    if (key === "latitude" || key === "longitude") {
      const n = Number(editField.value);
      v = Number.isFinite(n) ? n : undefined;
    }
    if (key === "password" && typeof v === "string" && !v.trim()) {
      setEditField(null);
      return;
    }
    if (key === "address" && typeof v === "string") {
      void patchSeller({ address: v, location: v });
    } else {
      void patchSeller({ [key]: v });
    }
    setEditField(null);
  }

  if (!sellerId) {
    return (
      <div className="page">
        <p className="muted">Missing seller id.</p>
      </div>
    );
  }

  if (!seller) {
    return (
      <div className="page">
        <p className="muted">Loading seller…</p>
      </div>
    );
  }

  const lat = seller.latitude;
  const lng = seller.longitude;
  const lastActive = formatDate(seller.lastActiveAt as never);
  const trialEnd = formatDate(seller.trialEnd as never);
  const trialStart = formatDate(seller.trialStart as never);
  const state = sellerUiState(seller);
  const waShopCredentialsUrl = shopCodeWhatsAppHref();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{seller.shopName ?? "Seller"}</h1>
          <p className="muted">
            <SellerStatusBadge seller={seller} /> · <span className="mono">{seller.id}</span>
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn btn--ghost" to={`${base}/sellers`}>
            ← Sellers
          </Link>
          <a className="btn btn--ghost" href={waLink(seller.phone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <Button variant="ghost" onClick={() => exportReport()}>
            Export CSV
          </Button>
        </div>
      </header>

      <Card title="Seller profile">
        <div className="kv-grid">
          <div className="kv">
            <div className="kv__k">Seller ID</div>
            <div className="kv__v mono small">{seller.id}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Shop code</div>
            <div className="kv__v">
              {seller.shopCode ? (
                <span className="shop-code-badge">{seller.shopCode}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          </div>
          <div className="kv">
            <div className="kv__k">Phone</div>
            <div className="kv__v">{seller.phone ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Shop name</div>
            <div className="kv__v">{seller.shopName ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Owner</div>
            <div className="kv__v">{seller.ownerName ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Address</div>
            <div className="kv__v">{seller.address ?? seller.location ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Slots</div>
            <div className="kv__v">{String(seller.slots ?? 0)}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Mode</div>
            <div className="kv__v">{seller.sellerMode ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Orders</div>
            <div className="kv__v">{String(stats.orderCount)}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Revenue</div>
            <div className="kv__v">{formatMoney(stats.revenue)}</div>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: "0.85rem" }}>
          <Button variant="ghost" disabled={busy} onClick={() => setResetShopCodeOpen(true)}>
            Reset Shop Code
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !seller.shopCode}
            onClick={() => void navigator.clipboard.writeText(seller.shopCode ?? "")}
          >
            Copy Code
          </Button>
          <a
            className="btn btn--ghost"
            href={waShopCredentialsUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={waShopCredentialsUrl === "#"}
            style={waShopCredentialsUrl === "#" ? { pointerEvents: "none", opacity: 0.45 } : undefined}
          >
            Send via WhatsApp
          </a>
        </div>
      </Card>

      <div className="split-2">
        <Card title="Shop">
          {seller.shopImageUrl ? (
            <img className="img-preview" src={seller.shopImageUrl} alt="Shop" />
          ) : (
            <p className="muted">No shop image</p>
          )}
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <label className="btn btn--ghost" style={{ cursor: "pointer" }}>
              Upload / replace
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadShopImage(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button variant="danger" disabled={busy || !seller.shopImageUrl} onClick={() => void removeImage("shopImageUrl")}>
              Remove image
            </Button>
          </div>
        </Card>

        <Card title="QR & delivery">
          {seller.qrImageUrl ? <img className="img-preview" src={seller.qrImageUrl} alt="QR" /> : <p className="muted">No QR uploaded</p>}
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <label className="btn btn--ghost" style={{ cursor: "pointer" }}>
              Upload QR
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadQr(f);
                  e.target.value = "";
                }}
              />
            </label>
            <Button variant="danger" disabled={busy || !seller.qrImageUrl} onClick={() => void removeImage("qrImageUrl")}>
              Remove QR
            </Button>
            <Button
              variant="ghost"
              onClick={() => void patchSeller({ deliveryEnabled: !seller.deliveryEnabled })}
              disabled={busy}
            >
              Toggle delivery ({seller.deliveryEnabled ? "off" : "on"})
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Profile">
        <div className="kv-grid">
          <div className="kv">
            <div className="kv__k">Delivery</div>
            <div className="kv__v">{seller.deliveryEnabled ? "ON" : "OFF"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">UPI</div>
            <div className="kv__v">{seller.upiId ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Timings</div>
            <div className="kv__v">
              {seller.openTime ?? "—"} – {seller.closeTime ?? "—"}
            </div>
          </div>
          <div className="kv">
            <div className="kv__k">Trial</div>
            <div className="kv__v">
              {trialStart} → {trialEnd} ({isTrialActive(seller) ? "active" : "ended"})
            </div>
          </div>
          <div className="kv">
            <div className="kv__k">Wallet (approved billing)</div>
            <div className="kv__v">{formatMoney(Number(seller.walletBalance ?? 0))}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Last active</div>
            <div className="kv__v">{lastActive}</div>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: "0.75rem" }}>
          <Button variant="ghost" onClick={() => setEditField({ key: "ownerName", label: "Owner name", value: seller.ownerName ?? "" })}>
            Edit owner
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "phone", label: "Phone", value: seller.phone ?? "" })}>
            Change phone
          </Button>
          <Button
            variant="ghost"
            onClick={() => setEditField({ key: "password", label: "Shop login password", value: seller.password ?? "" })}
          >
            Change password
          </Button>
          <Button
            variant="ghost"
            onClick={() => setEditField({ key: "address", label: "Address", value: seller.address ?? seller.location ?? "", multiline: true })}
          >
            Address
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "shopName", label: "Shop name", value: seller.shopName ?? "" })}>
            Shop name
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "upiId", label: "UPI ID", value: seller.upiId ?? "" })}>
            UPI
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "openTime", label: "Open time (HH:mm)", value: seller.openTime ?? "" })}>
            Open time
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "closeTime", label: "Close time (HH:mm)", value: seller.closeTime ?? "" })}>
            Close time
          </Button>
        </div>
      </Card>

      <Card title="Pricing override (optional)">
        <p className="muted small" style={{ marginBottom: "0.75rem" }}>
          When enabled, seller apps should prefer these values over global settings (<code className="code">settings/global</code>).
        </p>
        <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={ovEnabled} onChange={(e) => setOvEnabled(e.target.checked)} />
          <span>Use custom pricing for this seller</span>
        </label>
        <div className="split-2" style={{ marginTop: "0.5rem" }}>
          <label className="field">
            <span>Custom trial days</span>
            <input className="input" value={ovTrial} onChange={(e) => setOvTrial(e.target.value)} placeholder="leave blank = global" inputMode="numeric" />
          </label>
          <label className="field">
            <span>Custom slot rate / day</span>
            <input className="input" value={ovSlotRate} onChange={(e) => setOvSlotRate(e.target.value)} placeholder="INR" inputMode="decimal" />
          </label>
        </div>
        <div className="split-2">
          <label className="field">
            <span>Custom order fee %</span>
            <input className="input" value={ovFee} onChange={(e) => setOvFee(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Custom preset amounts (JSON)</span>
            <textarea className="input input--area" rows={2} value={ovPresetsJson} onChange={(e) => setOvPresetsJson(e.target.value)} />
          </label>
        </div>
        <Button onClick={() => void savePricingOverrides()} disabled={busy}>
          Save overrides
        </Button>
      </Card>

      <Card title="Location">
        <p className="muted small">{seller.address ?? seller.location ?? "—"}</p>
        {lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? (
          <iframe
            className="map-embed"
            title="Map"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.02}%2C${lat - 0.02}%2C${lng + 0.02}%2C${lat + 0.02}&layer=mapnik&marker=${lat}%2C${lng}`}
          />
        ) : (
          <p className="muted">Add latitude/longitude to enable map preview.</p>
        )}
        <div className="btn-row" style={{ marginTop: "0.5rem" }}>
          <Button
            variant="ghost"
            onClick={() =>
              setEditField({
                key: "latitude",
                label: "Latitude",
                value: String(seller.latitude ?? ""),
              })
            }
          >
            Edit lat
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setEditField({
                key: "longitude",
                label: "Longitude",
                value: String(seller.longitude ?? ""),
              })
            }
          >
            Edit lng
          </Button>
        </div>
      </Card>

      <Card title="Recent orders">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>When</th>
                <th>Buyer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 15).map((o) => (
                <tr key={o.id}>
                  <td className="mono small">{o.id}</td>
                  <td className="muted small">{formatDate(o.createdAt as never)}</td>
                  <td>
                    <div>{o.buyerName ?? "—"}</div>
                    <div className="muted small">{o.buyerPhone ?? "—"}</div>
                  </td>
                  <td className="cell-clamp small">{summarizeItems(o.items as unknown[])}</td>
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

      <Card title="Analytics">
        <div className="stat-grid">
          {[
            { label: "Orders (all)", value: String(stats.orderCount) },
            { label: "Pending", value: String(stats.pending) },
            { label: "Completed", value: String(stats.completed) },
            { label: "Cancelled", value: String(stats.cancelled) },
            { label: "Revenue total", value: formatMoney(stats.revenue) },
            { label: "Today revenue", value: formatMoney(stats.todayRev) },
            { label: "Repeat buyers (2+)", value: String(stats.repeatBuyers) },
          ].map((t) => (
            <div key={t.label} className="neon-card">
              <div className="neon-card__body">
                <div className="muted small">{t.label}</div>
                <div className="stat-value" style={{ fontSize: "1.35rem" }}>
                  {t.value}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "1rem" }}>
          <SimpleBarChart title="Top products (line items)" points={stats.topProducts} />
        </div>
      </Card>

      <Card title="Quick actions">
        <div className="btn-row">
          <Button variant="ghost" disabled={busy} onClick={() => void applySlots(1, "add")}>
            +1 slot
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void applySlots(5, "add")}>
            +5 slots
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void applySlots(10, "add")}>
            +10 slots
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSlotModal(true)}>
            Custom slots
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void patchSeller({ isLive: !seller.isLive })}>
            Toggle live (now {seller.isLive ? "on" : "off"})
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void patchSeller({ isLive: false })}>
            Trial mode (live off)
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const slots = Number(seller.slots ?? 0);
              if (slots <= 0) void patchSeller({ isLive: true, slots: 1 });
              else void patchSeller({ isLive: true });
            }}
          >
            Activate live (+1 slot if none)
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void applySlots(-1, "add")}>
            Remove 1 slot
          </Button>
          <label className="field" style={{ margin: 0, minWidth: "120px" }}>
            <span className="muted small">Extend trial (days)</span>
            <input className="input" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} inputMode="numeric" />
          </label>
          <Button variant="ghost" disabled={busy} onClick={() => void extendTrial()}>
            Extend trial
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void patchSeller({ isBlocked: !seller.isBlocked })}>
            {seller.isBlocked ? "Unblock" : "Block"}
          </Button>
        </div>
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          State: <strong>{state}</strong>. Live sellers typically have slots &gt; 0 and are not blocked.
        </p>
      </Card>

      <Card title="Danger zone">
        <div className="btn-row">
          <Button variant="danger" disabled={busy} onClick={() => void deleteAllProducts()}>
            Delete all products
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void deleteAllOrders()}>
            Delete all orders
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void deleteAccount({ products: true, orders: true })}
          >
            Delete seller + products + orders
          </Button>
        </div>
      </Card>

      <Modal
        open={slotModal}
        title="Slots"
        onClose={() => setSlotModal(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlotModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const raw = slotDelta.trim();
                if (raw.startsWith("=")) {
                  const n = Number(raw.slice(1));
                  if (Number.isFinite(n)) void applySlots(n, "set");
                } else {
                  const n = Number(raw);
                  if (Number.isFinite(n)) void applySlots(n, "add");
                }
              }}
              disabled={busy}
            >
              Apply
            </Button>
          </>
        }
      >
        <p className="muted small">
          Enter a number to <strong>add</strong> slots, or <code className="code">=50</code> to set an exact balance.
        </p>
        <label className="field">
          <span>Value</span>
          <input className="input" value={slotDelta} onChange={(e) => setSlotDelta(e.target.value)} placeholder="10 or =50" />
        </label>
      </Modal>

      <Modal
        open={resetShopCodeOpen}
        title="Reset shop code?"
        onClose={() => !busy && setResetShopCodeOpen(false)}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setResetShopCodeOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void performResetShopCode()}>
              Reset code
            </Button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          The old code stops working as soon as you confirm. Share the new code with the seller.
        </p>
      </Modal>

      <Modal
        open={!!editField}
        title={editField?.label ?? "Edit"}
        onClose={() => setEditField(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditField(null)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-seller-field">
              Save
            </Button>
          </>
        }
      >
        {editField ? (
          <form id="edit-seller-field" onSubmit={(e) => void saveEdit(e)}>
            {editField.multiline ? (
              <textarea className="input input--area" rows={4} value={editField.value} onChange={(e) => setEditField({ ...editField, value: e.target.value })} />
            ) : (
              <input
                className="input"
                value={editField.value}
                onChange={(e) => setEditField({ ...editField, value: e.target.value })}
                type={editField.key === "password" ? "password" : "text"}
              />
            )}
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
