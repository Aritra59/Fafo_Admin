import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { COLLECTIONS } from "../services/adminFirestore";

export function CreateBuyer() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const latN = Number(lat);
      const lngN = Number(lng);
      await addDoc(collection(db, COLLECTIONS.users), {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        location: address.trim(),
        latitude: Number.isFinite(latN) ? latN : undefined,
        longitude: Number.isFinite(lngN) ? lngN : undefined,
        role: "buyer",
        isBlocked: false,
        createdAt: serverTimestamp(),
      });
      setName("");
      setPhone("");
      setAddress("");
      setLat("");
      setLng("");
      window.alert("Buyer created.");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Create buyer</h1>
          <p className="muted">Adds a document to users with role buyer.</p>
        </div>
        <Link className="link-inline" to={`${base}/buyers`}>
          ← Buyers
        </Link>
      </header>

      <Card title="New buyer">
        <form className="stack max-w-md" onSubmit={(e) => void onSubmit(e)}>
          {err ? <p className="error-text">{err}</p> : null}
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Phone</span>
            <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
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
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create buyer"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
