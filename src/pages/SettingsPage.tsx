import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, type DocumentData } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { COLLECTIONS, deleteStorageFileIfUrl, SETTINGS_GLOBAL_ID } from "../services/adminFirestore";
import type { GlobalSettings } from "../types/models";

const SETTINGS_REF = doc(db, COLLECTIONS.settings, SETTINGS_GLOBAL_ID);

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseNumberList(raw: string, fallback: number[]): number[] {
  const v = parseJson<unknown>(raw, null);
  if (Array.isArray(v)) {
    return v.map((x) => Math.max(0, Number(x))).filter((n) => Number.isFinite(n));
  }
  return fallback;
}

export function SettingsPage() {
  const [platformFee, setPlatformFee] = useState("");
  const [commission, setCommission] = useState("");
  const [orderFeePercent, setOrderFeePercent] = useState("");
  const [trialDaysDefault, setTrialDaysDefault] = useState("15");
  const [slotRatePerDay, setSlotRatePerDay] = useState("");
  const [defaultRechargeDays, setDefaultRechargeDays] = useState("");
  const [presetAmountsJson, setPresetAmountsJson] = useState("[500, 1000, 2000]");
  const [slotPackagesJson, setSlotPackagesJson] = useState(
    JSON.stringify([{ label: "Starter", slots: 10, price: 500 }], null, 2)
  );
  const [deliveryRadius, setDeliveryRadius] = useState("5");
  const [whatsappSupport, setWhatsappSupport] = useState("");
  const [globalUpiId, setGlobalUpiId] = useState("");
  const [billingTermsText, setBillingTermsText] = useState("");
  const [globalQrImageUrl, setGlobalQrImageUrl] = useState("");
  const [appBannersJson, setAppBannersJson] = useState(
    JSON.stringify([{ title: "Welcome", body: "", enabled: true }], null, 2)
  );
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [forceCloseOrdering, setForceCloseOrdering] = useState(false);
  const [buyerShopPublicUrlTemplate, setBuyerShopPublicUrlTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onSnapshot(SETTINGS_REF, (snap) => {
      const d = (snap.exists() ? snap.data() : {}) as DocumentData & GlobalSettings;
      setPlatformFee(String(d.platformFee ?? ""));
      const ofp = d.orderFeePercent ?? d.commissionPercent;
      setCommission(String(d.commissionPercent ?? ""));
      setOrderFeePercent(String(ofp ?? d.commissionPercent ?? ""));
      setTrialDaysDefault(String(d.trialDaysDefault ?? d.trialDays ?? 15));
      setSlotRatePerDay(String(d.slotRatePerDay ?? ""));
      setDefaultRechargeDays(String(d.defaultRechargeDays ?? ""));
      setPresetAmountsJson(JSON.stringify(d.presetAmounts ?? [500, 1000, 2000], null, 2));
      setSlotPackagesJson(JSON.stringify(d.slotPackages ?? [{ label: "Starter", slots: 10, price: 500 }], null, 2));
      setDeliveryRadius(String(d.deliveryDefaultRadiusKm ?? 5));
      setWhatsappSupport(String(d.whatsappSupport ?? ""));
      setGlobalUpiId(String(d.globalUpiId ?? ""));
      setBillingTermsText(String(d.billingTermsText ?? ""));
      setGlobalQrImageUrl(String(d.globalQrImageUrl ?? ""));
      setAppBannersJson(JSON.stringify(d.appBanners ?? [], null, 2));
      setMaintenanceMode(Boolean(d.maintenanceMode));
      setForceCloseOrdering(Boolean(d.forceCloseOrdering));
      setBuyerShopPublicUrlTemplate(String(d.buyerShopPublicUrlTemplate ?? ""));
    });
  }, []);

  async function onUploadGlobalQr(file: File) {
    setBusy(true);
    try {
      if (globalQrImageUrl) await deleteStorageFileIfUrl(globalQrImageUrl);
      const path = `settings/global/qr-${Date.now()}-${file.name.replace(/\s/g, "_")}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setGlobalQrImageUrl(url);
      await setDoc(SETTINGS_REF, { globalQrImageUrl: url }, { merge: true });
    } finally {
      setBusy(false);
    }
  }

  async function removeGlobalQr() {
    if (!globalQrImageUrl) return;
    setBusy(true);
    try {
      await deleteStorageFileIfUrl(globalQrImageUrl);
      await setDoc(SETTINGS_REF, { globalQrImageUrl: "" }, { merge: true });
      setGlobalQrImageUrl("");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const slotPackages = parseJson(slotPackagesJson, [] as GlobalSettings["slotPackages"]);
      const appBanners = parseJson(appBannersJson, [] as GlobalSettings["appBanners"]);
      const presetAmounts = parseNumberList(presetAmountsJson, [500, 1000, 2000]);
      const trialN = Math.max(1, Math.floor(Number(trialDaysDefault) || 15));
      const ofp = Number(orderFeePercent) || Number(commission) || 0;
      await setDoc(
        SETTINGS_REF,
        {
          platformFee: Number(platformFee) || 0,
          commissionPercent: ofp,
          orderFeePercent: ofp,
          trialDaysDefault: trialN,
          trialDays: trialN,
          slotRatePerDay: Math.max(0, Number(slotRatePerDay) || 0),
          defaultRechargeDays: Math.max(0, Math.floor(Number(defaultRechargeDays) || 0)),
          presetAmounts,
          slotPackages,
          deliveryDefaultRadiusKm: Math.max(0, Number(deliveryRadius) || 0),
          whatsappSupport: whatsappSupport.trim(),
          globalUpiId: globalUpiId.trim(),
          billingTermsText: billingTermsText.trim(),
          globalQrImageUrl: globalQrImageUrl.trim() || "",
          appBanners,
          maintenanceMode,
          forceCloseOrdering,
          buyerShopPublicUrlTemplate: buyerShopPublicUrlTemplate.trim(),
        },
        { merge: true }
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Global billing &amp; settings</h1>
          <p className="muted">Document: settings/{SETTINGS_GLOBAL_ID}</p>
        </div>
      </header>

      <Card title="Business rules (FaFo)">
        <div className="stack max-w-md">
          <label className="field">
            <span>Trial days (default for new sellers)</span>
            <input className="input" value={trialDaysDefault} onChange={(e) => setTrialDaysDefault(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Slot rate per day (INR)</span>
            <input className="input" value={slotRatePerDay} onChange={(e) => setSlotRatePerDay(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Order fee (%)</span>
            <input className="input" value={orderFeePercent} onChange={(e) => setOrderFeePercent(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Default recharge days (slot purchase)</span>
            <input className="input" value={defaultRechargeDays} onChange={(e) => setDefaultRechargeDays(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span>Preset recharge amounts (JSON array of numbers)</span>
            <textarea className="input input--area" rows={3} value={presetAmountsJson} onChange={(e) => setPresetAmountsJson(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Payments &amp; contact">
        <div className="stack max-w-md">
          <label className="field">
            <span>Buyer public shop URL template</span>
            <input
              className="input"
              value={buyerShopPublicUrlTemplate}
              onChange={(e) => setBuyerShopPublicUrlTemplate(e.target.value)}
              placeholder="https://fafo.app/s/{shopCode}"
            />
            <span className="muted small">
              Include the literal <code className="code">{"{shopCode}"}</code> once. Used on seller detail for copyable public links.
            </span>
          </label>
          <label className="field">
            <span>UPI ID (global)</span>
            <input className="input" value={globalUpiId} onChange={(e) => setGlobalUpiId(e.target.value)} placeholder="merchant@upi" />
          </label>
          <div>
            <span className="muted small">QR image (global)</span>
            {globalQrImageUrl ? <img className="img-preview" src={globalQrImageUrl} alt="Global QR" style={{ marginTop: "0.5rem" }} /> : null}
            <div className="btn-row" style={{ marginTop: "0.5rem" }}>
              <label className="btn btn--ghost" style={{ cursor: "pointer" }}>
                Upload QR
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUploadGlobalQr(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <Button variant="danger" disabled={busy || !globalQrImageUrl} onClick={() => void removeGlobalQr()}>
                Remove QR
              </Button>
            </div>
          </div>
          <label className="field">
            <span>WhatsApp number (support)</span>
            <input className="input" value={whatsappSupport} onChange={(e) => setWhatsappSupport(e.target.value)} placeholder="+91…" />
          </label>
          <label className="field">
            <span>Terms / notes (shown to sellers)</span>
            <textarea className="input input--area" rows={5} value={billingTermsText} onChange={(e) => setBillingTermsText(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Economics &amp; legacy">
        <div className="stack max-w-md">
          <label className="field">
            <span>Platform fee</span>
            <input className="input" value={platformFee} onChange={(e) => setPlatformFee(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            <span>Commission % (legacy mirror)</span>
            <input className="input" value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" />
          </label>
        </div>
      </Card>

      <Card title="Slot packages (JSON)">
        <label className="field">
          <span>Array of packages: label, slots, price</span>
          <textarea className="input input--area" rows={8} value={slotPackagesJson} onChange={(e) => setSlotPackagesJson(e.target.value)} />
        </label>
      </Card>

      <Card title="Operations">
        <div className="stack max-w-md">
          <label className="field">
            <span>Default delivery radius (km)</span>
            <input className="input" value={deliveryRadius} onChange={(e) => setDeliveryRadius(e.target.value)} inputMode="decimal" />
          </label>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
            <span>Maintenance mode</span>
          </label>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={forceCloseOrdering} onChange={(e) => setForceCloseOrdering(e.target.checked)} />
            <span>Force close ordering (global)</span>
          </label>
        </div>
      </Card>

      <Card title="App banners (JSON)">
        <label className="field">
          <span>title, body, enabled</span>
          <textarea className="input input--area" rows={6} value={appBannersJson} onChange={(e) => setAppBannersJson(e.target.value)} />
        </label>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save all settings"}
        </Button>
        <p className="muted small">After you save, connected apps pick up these values automatically.</p>
      </Card>
    </div>
  );
}
