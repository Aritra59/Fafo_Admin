import { useState, type FormEvent } from "react";
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
import { COLLECTIONS, generateUniqueShopCode } from "../services/adminFirestore";
import { waMessageLink } from "../lib/format";

export function CreateSeller() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("21:00");
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [upiId, setUpiId] = useState("");
  const [trialDays, setTrialDays] = useState("15");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; phone: string; shopCode: string; password: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const td = Math.max(1, Math.floor(Number(trialDays) || 15));
    setBusy(true);
    try {
      const shopCode = await generateUniqueShopCode(shopName.trim());
      const trialEnd = Timestamp.fromMillis(Date.now() + td * 86400000);
      const trialStart = Timestamp.now();
      const latN = Number(lat);
      const lngN = Number(lng);
      const ref = await addDoc(collection(db, COLLECTIONS.sellers), {
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        password: password,
        shopName: shopName.trim(),
        address: address.trim(),
        location: address.trim(),
        latitude: Number.isFinite(latN) ? latN : undefined,
        longitude: Number.isFinite(lngN) ? lngN : undefined,
        openTime,
        closeTime,
        deliveryEnabled,
        upiId: upiId.trim() || undefined,
        trialStart,
        trialEnd,
        shopCode,
        slots: 0,
        isLive: false,
        isBlocked: false,
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
      setDone({ id: ref.id, phone: phone.trim(), shopCode, password });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  function copyCreds() {
    if (!done) return;
    const text = `Seller Created Successfully\n\nPhone: ${done.phone}\nPassword: ${done.password}\nShop Code: ${done.shopCode}`;
    void navigator.clipboard.writeText(text);
  }

  function whatsappCreds() {
    if (!done) return;
    const body = `Seller Created Successfully\n\nPhone: ${done.phone}\nPassword: ${done.password}\nShop Code: ${done.shopCode}`;
    const url = waMessageLink(done.phone, body);
    if (url !== "#") window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Create seller</h1>
          <p className="muted">Creates a seller document, login mirror in users, and a unique shop code.</p>
        </div>
        <Link className="link-inline" to={`${base}/sellers`}>
          ← Back to sellers
        </Link>
      </header>

      <Card title="New seller">
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
            <span>Password (shop code login)</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Shop name</span>
            <input className="input" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Address</span>
            <textarea className="input input--area" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <div className="split-2">
            <label className="field">
              <span>Latitude</span>
              <input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            </label>
            <label className="field">
              <span>Longitude</span>
              <input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            </label>
          </div>
          <div className="split-2">
            <label className="field">
              <span>Open time</span>
              <input className="input" type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
            </label>
            <label className="field">
              <span>Close time</span>
              <input className="input" type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
            </label>
          </div>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
            <span>Delivery enabled</span>
          </label>
          <label className="field">
            <span>UPI ID (optional)</span>
            <input className="input" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
          </label>
          <label className="field">
            <span>Trial days</span>
            <input className="input" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create seller"}
          </Button>
        </form>
      </Card>

      <Modal
        open={!!done}
        title="Seller Created Successfully"
        onClose={() => setDone(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDone(null)}>
              Close
            </Button>
            <Button variant="ghost" onClick={() => copyCreds()}>
              Copy Credentials
            </Button>
            <Button onClick={() => whatsappCreds()}>WhatsApp Seller</Button>
          </>
        }
      >
        {done ? (
          <div className="stack">
            <p className="muted small" style={{ marginTop: 0 }}>
              Seller ID <span className="mono">{done.id}</span> — saved in Firestore for your records.
            </p>
            <div className="kv-grid">
              <div className="kv">
                <div className="kv__k">Phone</div>
                <div className="kv__v">{done.phone}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Password</div>
                <div className="kv__v mono">{done.password}</div>
              </div>
              <div className="kv">
                <div className="kv__k">Shop Code</div>
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
