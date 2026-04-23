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
  isShopCodeTaken,
  isTrialActive,
  sellerBillingAccessLabel,
  sellerUiState,
  toCsvRow,
  tsToDate,
} from "../services/adminFirestore";
import { LocationMapPicker, type MapLocationValue } from "../components/admin/LocationMapPicker";
import { SellerMenusPanel } from "../components/admin/SellerMenusPanel";
import { SellerProductsPanel } from "../components/admin/SellerProductsPanel";
import { formatMoney, formatDate, summarizeItems, waLink, waMessageLink } from "../lib/format";
import { orderTimeMs } from "../lib/orderTime";
import type { BillingPlanType, Order, OrderItem, Seller } from "../types/models";

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
  const [mapOpen, setMapOpen] = useState(false);
  const [mapDraft, setMapDraft] = useState<MapLocationValue | null>(null);
  const [trialModal, setTrialModal] = useState(false);
  const [trialStartInput, setTrialStartInput] = useState("");
  const [trialEndInput, setTrialEndInput] = useState("");
  const [resetStoreOpen, setResetStoreOpen] = useState(false);

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
    let revLast30 = 0;
    let revPrev30 = 0;
    let ordersLast30 = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const now = Date.now();
    const ms30 = 30 * 86400000;
    const productCounts = new Map<string, number>();
    const buyerCounts = new Map<string, number>();

    for (const o of list) {
      if (isOrderPending(o.status)) pending += 1;
      const t = tsToDate(o.createdAt as never);
      const tms = t ? t.getTime() : 0;
      if (isOrderCompleted(o.status)) {
        completed += 1;
        const amt = Number(o.total ?? 0);
        revenue += amt;
        if (t && t >= startOfToday) todayRev += amt;
        if (tms && tms >= now - ms30 && tms <= now) {
          revLast30 += amt;
          ordersLast30 += 1;
        }
        if (tms && tms >= now - 2 * ms30 && tms < now - ms30) {
          revPrev30 += amt;
        }
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

    const growthPct =
      revPrev30 > 0 ? ((revLast30 - revPrev30) / revPrev30) * 100 : revLast30 > 0 ? 100 : revPrev30 === 0 && revLast30 === 0 ? 0 : null;

    return {
      pending,
      completed,
      cancelled,
      revenue,
      todayRev,
      revLast30,
      revPrev30,
      ordersLast30,
      growthPct,
      topProducts,
      repeatBuyers,
      orderCount: list.length,
    };
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
      "Your FaFo shop is ready:",
      `Shop code: ${seller.shopCode ?? ""}`,
      `Phone: ${seller.phone ?? ""}`,
      "Open the FaFo seller app and sign in with your shop code.",
    ];
    const waPhone = (seller.whatsappNumber ?? seller.phone ?? "").trim();
    return waMessageLink(waPhone, lines.join("\n"));
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

  async function resetStorefront() {
    if (!sellerId || !seller) return;
    setBusy(true);
    try {
      await deleteSellerProducts(sellerId);
      await deleteStorageFileIfUrl(seller.shopImageUrl ?? "");
      await deleteStorageFileIfUrl(seller.qrImageUrl ?? "");
      await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), {
        shopImageUrl: deleteField(),
        qrImageUrl: deleteField(),
      });
      setResetStoreOpen(false);
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

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editField) return;
    const key = editField.key;
    let v: unknown = editField.value;
    if (key === "latitude" || key === "longitude") {
      const n = Number(editField.value);
      v = Number.isFinite(n) ? n : undefined;
    }
    if (key === "shopCode" && typeof v === "string") {
      const code = v.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        window.alert("Shop code must be 4–12 letters or numbers.");
        return;
      }
      const taken = await isShopCodeTaken(code, sellerId);
      if (taken) {
        window.alert("That shop code is already in use.");
        return;
      }
      v = code;
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

  const cur: Seller = seller;

  const lat = cur.latitude;
  const lng = cur.longitude;
  const lastActive = formatDate(cur.lastActiveAt as never);
  const trialEnd = formatDate(cur.trialEnd as never);
  const trialStart = formatDate(cur.trialStart as never);
  const state = sellerUiState(cur);
  const waShopCredentialsUrl = shopCodeWhatsAppHref();
  const accessLabel = sellerBillingAccessLabel(cur);

  function openMapEditor() {
    const la = Number(cur.latitude);
    const ln = Number(cur.longitude);
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      setMapDraft({
        lat: la,
        lng: ln,
        address: String(cur.address ?? cur.location ?? ""),
        city: cur.locationCity,
        state: cur.locationState,
      });
    } else {
      setMapDraft({ lat: 20.5937, lng: 78.9629, address: "" });
    }
    setMapOpen(true);
  }

  function openTrialEditor() {
    const fmt = (ts: unknown) => {
      const d = tsToDate(ts as never);
      if (!d) return "";
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    setTrialStartInput(fmt(cur.trialStart));
    setTrialEndInput(fmt(cur.trialEnd));
    setTrialModal(true);
  }

  async function saveMapLocation() {
    if (!sellerId || !mapDraft) return;
    await patchSeller({
      latitude: mapDraft.lat,
      longitude: mapDraft.lng,
      address: mapDraft.address.trim(),
      location: mapDraft.address.trim(),
      locationCity: mapDraft.city?.trim() || deleteField(),
      locationState: mapDraft.state?.trim() || deleteField(),
    });
    setMapOpen(false);
  }

  async function saveTrialDates() {
    if (!sellerId) return;
    const s = new Date(trialStartInput);
    const en = new Date(trialEndInput);
    if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) {
      window.alert("Invalid dates.");
      return;
    }
    await patchSeller({
      trialStart: Timestamp.fromDate(s),
      trialEnd: Timestamp.fromDate(en),
    });
    setTrialModal(false);
  }

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
            <div className="kv__k">WhatsApp</div>
            <div className="kv__v">{seller.whatsappNumber ?? seller.phone ?? "—"}</div>
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

      <Card title="Billing & selling">
        <div className="kv-grid">
          <div className="kv">
            <div className="kv__k">Plan type</div>
            <div className="kv__v">{seller.billingPlanType ?? "—"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Trial</div>
            <div className="kv__v">
              {isTrialActive(seller) ? (
                <>
                  <span className="pill pill--trial">Active</span>
                  {(() => {
                    const end = tsToDate(seller.trialEnd as never);
                    if (!end) return null;
                    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
                    return <span className="muted small"> · {Math.max(0, days)} days left</span>;
                  })()}
                </>
              ) : (
                <span className="pill pill--muted">Not active</span>
              )}
            </div>
          </div>
          <div className="kv">
            <div className="kv__k">Due amount</div>
            <div className="kv__v">{formatMoney(Number(seller.pendingDues ?? 0))}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Selling</div>
            <div className="kv__v">{seller.sellingEnabled === false ? "Blocked (unpaid or manual)" : "Allowed"}</div>
          </div>
          <div className="kv">
            <div className="kv__k">Access</div>
            <div className="kv__v">
              <span className="pill pill--live">{accessLabel}</span>
            </div>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: "0.75rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
          <Button variant="ghost" disabled={busy} onClick={() => void patchSeller({ sellingEnabled: true, pendingDues: 0 })}>
            Mark paid — enable selling
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void patchSeller({ sellingEnabled: false })}>
            Mark unpaid — disable selling
          </Button>
          <label className="field" style={{ margin: 0, minWidth: "140px" }}>
            <span className="muted small">Pending dues (INR)</span>
            <input
              className="input"
              inputMode="decimal"
              defaultValue={String(seller.pendingDues ?? 0)}
              key={`dues-${seller.id}-${seller.pendingDues}`}
              onBlur={(e) => {
                const n = Math.max(0, Number(e.target.value) || 0);
                void patchSeller({ pendingDues: n });
              }}
            />
          </label>
          <label className="field" style={{ margin: 0, minWidth: "160px" }}>
            <span className="muted small">Plan</span>
            <select
              className="input"
              value={(seller.billingPlanType as BillingPlanType) ?? "trial"}
              onChange={(e) => void patchSeller({ billingPlanType: e.target.value })}
            >
              <option value="trial">Trial</option>
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
              <option value="slot">Slot-based</option>
            </select>
          </label>
          <Button variant="ghost" disabled={busy} onClick={() => openTrialEditor()}>
            Edit trial dates
          </Button>
        </div>
      </Card>

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
            onClick={() => setEditField({ key: "whatsappNumber", label: "WhatsApp number", value: seller.whatsappNumber ?? seller.phone ?? "" })}
          >
            WhatsApp number
          </Button>
          <Button variant="ghost" onClick={() => setEditField({ key: "shopCode", label: "Shop code", value: seller.shopCode ?? "" })}>
            Shop code
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
          When enabled, this seller&apos;s app should prefer these values over your global control panel defaults.
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
        {(seller.locationCity || seller.locationState) && (
          <p className="muted small">
            {[seller.locationCity, seller.locationState].filter(Boolean).join(", ")}
          </p>
        )}
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
          <Button variant="ghost" onClick={() => openMapEditor()}>
            Pick on map
          </Button>
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

      <SellerMenusPanel sellerId={sellerId} />

      <SellerProductsPanel sellerId={sellerId} />

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

      <Card title="Shop analytics">
        <div className="stat-grid">
          {[
            { label: "Orders (all)", value: String(stats.orderCount) },
            { label: "Orders (30d)", value: String(stats.ordersLast30) },
            { label: "Pending", value: String(stats.pending) },
            { label: "Completed", value: String(stats.completed) },
            { label: "Cancelled", value: String(stats.cancelled) },
            { label: "Revenue total", value: formatMoney(stats.revenue) },
            { label: "Revenue (30d)", value: formatMoney(stats.revLast30) },
            { label: "Revenue (prev 30d)", value: formatMoney(stats.revPrev30) },
            {
              label: "Revenue growth (30d vs prior)",
              value: stats.growthPct == null ? "—" : `${stats.growthPct >= 0 ? "+" : ""}${stats.growthPct.toFixed(1)}%`,
            },
            { label: "Today revenue", value: formatMoney(stats.todayRev) },
            { label: "Repeat customers (2+ orders)", value: String(stats.repeatBuyers) },
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
          <Button variant="danger" disabled={busy} onClick={() => setResetStoreOpen(true)}>
            Reset storefront
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
          Enter a number to <strong>add</strong> slots. To set an exact balance, type equals then the number (example: =50).
        </p>
        <label className="field">
          <span>Value</span>
          <input className="input" value={slotDelta} onChange={(e) => setSlotDelta(e.target.value)} />
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
        open={mapOpen}
        title="Shop location"
        onClose={() => !busy && setMapOpen(false)}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setMapOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !mapDraft} onClick={() => void saveMapLocation()}>
              Save location
            </Button>
          </>
        }
      >
        {mapDraft ? <LocationMapPicker value={mapDraft} onChange={setMapDraft} /> : null}
      </Modal>

      <Modal
        open={trialModal}
        title="Trial period"
        onClose={() => !busy && setTrialModal(false)}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setTrialModal(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void saveTrialDates()}>
              Save dates
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Trial start</span>
          <input className="input" type="datetime-local" value={trialStartInput} onChange={(e) => setTrialStartInput(e.target.value)} />
        </label>
        <label className="field">
          <span>Trial end</span>
          <input className="input" type="datetime-local" value={trialEndInput} onChange={(e) => setTrialEndInput(e.target.value)} />
        </label>
      </Modal>

      <Modal
        open={resetStoreOpen}
        title="Reset storefront?"
        onClose={() => !busy && setResetStoreOpen(false)}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setResetStoreOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void resetStorefront()}>
              Reset
            </Button>
          </>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Removes every product for this shop and clears the shop hero image and QR image. Orders are kept.
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
                type="text"
              />
            )}
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
