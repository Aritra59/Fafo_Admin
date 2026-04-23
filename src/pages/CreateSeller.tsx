import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { LocationMapPicker, type MapLocationValue } from "../components/admin/LocationMapPicker";
import { COLLECTIONS, generateUniqueShopCode, isShopCodeTaken } from "../services/adminFirestore";
import { waMessageLink } from "../lib/format";

type BillingPlanType = "trial" | "monthly" | "daily" | "slot";

export function CreateSeller() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopCode, setShopCode] = useState("");
  const [shopCodeTouched, setShopCodeTouched] = useState(false);
  const [mapLoc, setMapLoc] = useState<MapLocationValue | null>(null);
  const [billingPlanType, setBillingPlanType] = useState<BillingPlanType>("trial");
  const [trialDays, setTrialDays] = useState("15");
  const [slots, setSlots] = useState("0");
  const [isLive, setIsLive] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [upiId, setUpiId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; phone: string; shopCode: string } | null>(null);

  useEffect(() => {
    if (shopCodeTouched) return;
    let cancelled = false;
    void (async () => {
      if (!shopName.trim()) return;
      try {
        const code = await generateUniqueShopCode(shopName.trim());
        if (!cancelled) setShopCode(code);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopName, shopCodeTouched]);

  async function refreshShopCode() {
    setErr(null);
    try {
      const code = await generateUniqueShopCode(shopName.trim() || "SHOP");
      setShopCode(code);
      setShopCodeTouched(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate code");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!mapLoc || !Number.isFinite(mapLoc.lat) || !Number.isFinite(mapLoc.lng)) {
      setErr("Choose a location on the map (search, use my location, or drag the pin).");
      return;
    }

    const code = shopCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) {
      setErr("Shop code must be 4–12 letters or numbers.");
      return;
    }

    const taken = await isShopCodeTaken(code);
    if (taken) {
      setErr("That shop code is already in use. Change it or generate a new one.");
      return;
    }

    const td = Math.max(1, Math.floor(Number(trialDays) || 15));
    const slotN = Math.max(0, Math.floor(Number(slots) || 0));
    const trialStart = Timestamp.now();
    const trialEnd = Timestamp.fromMillis(Date.now() + td * 86400000);
    const useTrial = billingPlanType === "trial";

    setBusy(true);
    try {
      const ref = await addDoc(collection(db, COLLECTIONS.sellers), {
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        whatsappNumber: whatsappNumber.trim() || phone.trim(),
        shopName: shopName.trim(),
        shopCode: code,
        address: mapLoc.address.trim(),
        location: mapLoc.address.trim(),
        locationCity: mapLoc.city?.trim() || null,
        locationState: mapLoc.state?.trim() || null,
        latitude: mapLoc.lat,
        longitude: mapLoc.lng,
        billingPlanType,
        trialStart,
        trialEnd: useTrial ? trialEnd : Timestamp.fromMillis(Date.now() + 365 * 86400000),
        trialHidden: !useTrial,
        trialExpired: false,
        trialSuppressed: !useTrial,
        slots: slotN,
        isLive: isBlocked ? false : isLive,
        isBlocked,
        sellingEnabled: !isBlocked,
        pendingDues: 0,
        upiId: upiId.trim() || undefined,
        sellerMode: useTrial ? "freeTrial" : isLive ? "live" : "demo",
        sellerBillingState: useTrial ? "freeTrial" : isLive ? "live" : "inactive",
        deliveryEnabled: true,
        openTime: "09:00",
        closeTime: "21:00",
        createdAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, COLLECTIONS.users, ref.id),
        {
          phone: phone.trim(),
          name: ownerName.trim(),
          role: "seller",
          sellerId: ref.id,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      setDone({ id: ref.id, phone: phone.trim(), shopCode: code });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  function copySummary() {
    if (!done) return;
    const text = `Seller ready\nPhone: ${done.phone}\nShop code: ${done.shopCode}\nSeller ID: ${done.id}`;
    void navigator.clipboard.writeText(text);
  }

  function whatsappSummary() {
    if (!done) return;
    const body = `Your shop is ready on FaFo.\nShop code: ${done.shopCode}\nPhone: ${done.phone}\nOpen the seller app and sign in with your shop code.`;
    const url = waMessageLink(done.phone, body);
    if (url !== "#") window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Create seller</h1>
          <p className="muted">Registers a seller profile and storefront access. No password is stored — sellers authenticate in the FaFo seller app.</p>
        </div>
        <Link className="link-inline" to={`${base}/sellers`}>
          ← Back to sellers
        </Link>
      </header>

      <Card title="Seller details">
        <form className="stack max-w-md" onSubmit={(e) => void onSubmit(e)}>
          {err ? <p className="error-text">{err}</p> : null}
          <label className="field">
            <span>Owner name</span>
            <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Phone</span>
            <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </label>
          <label className="field">
            <span>WhatsApp number</span>
            <input
              className="input"
              inputMode="tel"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="Same as phone if left blank"
            />
          </label>
          <label className="field">
            <span>Shop name</span>
            <input className="input" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Shop code</span>
            <div className="login-password-wrap" style={{ gap: "0.5rem" }}>
              <input
                className="input"
                value={shopCode}
                onChange={(e) => {
                  setShopCodeTouched(true);
                  setShopCode(e.target.value.toUpperCase());
                }}
                required
                minLength={4}
                maxLength={12}
                pattern="[A-Z0-9]+"
                title="Letters and numbers only"
              />
              <Button type="button" variant="ghost" onClick={() => void refreshShopCode()}>
                Generate
              </Button>
            </div>
          </label>

          <label className="field">
            <span>Billing plan</span>
            <select className="input" value={billingPlanType} onChange={(e) => setBillingPlanType(e.target.value as BillingPlanType)}>
              <option value="trial">Trial</option>
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
              <option value="slot">Slot-based</option>
            </select>
          </label>
          {billingPlanType === "trial" ? (
            <label className="field">
              <span>Trial length (days)</span>
              <input className="input" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </label>
          ) : null}
          <label className="field">
            <span>Slots</span>
            <input className="input" inputMode="numeric" value={slots} onChange={(e) => setSlots(e.target.value)} />
          </label>

          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={isLive} onChange={(e) => setIsLive(e.target.checked)} disabled={isBlocked} />
            <span>Shop is live (visible ordering)</span>
          </label>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={isBlocked}
              onChange={(e) => {
                const v = e.target.checked;
                setIsBlocked(v);
                if (v) setIsLive(false);
              }}
            />
            <span>Blocked (cannot sell)</span>
          </label>

          <label className="field">
            <span>UPI ID</span>
            <input className="input" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
          </label>

          <div style={{ marginTop: "0.5rem" }}>
            <div className="muted small" style={{ marginBottom: "0.5rem" }}>
              Location
            </div>
            <LocationMapPicker value={mapLoc} onChange={setMapLoc} />
          </div>

          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create seller"}
          </Button>
        </form>
      </Card>

      <Modal
        open={!!done}
        title="Seller created"
        onClose={() => setDone(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDone(null)}>
              Close
            </Button>
            <Button variant="ghost" onClick={() => copySummary()}>
              Copy summary
            </Button>
            <Button onClick={() => whatsappSummary()}>WhatsApp seller</Button>
          </>
        }
      >
        {done ? (
          <div className="stack">
            <p className="muted small" style={{ marginTop: 0 }}>
              Seller ID <span className="mono">{done.id}</span>
            </p>
            <div className="kv-grid">
              <div className="kv">
                <div className="kv__k">Phone</div>
                <div className="kv__v">{done.phone}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Shop code</div>
                <div className="kv__v">
                  <span className="shop-code-badge">{done.shopCode}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
