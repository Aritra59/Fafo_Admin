import { useEffect, useState, type FormEvent } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../../firebase";
import { Card } from "../Card";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { COLLECTIONS, deleteStorageFileIfUrl } from "../../services/adminFirestore";
import type { SellerMenu, SellerProduct } from "../../types/models";

function coerceQty(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function SellerProductsPanel({ sellerId }: { sellerId: string }) {
  const [rows, setRows] = useState<SellerProduct[]>([]);
  const [menus, setMenus] = useState<SellerMenu[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; p: SellerProduct }>(null);
  const [name, setName] = useState("");
  const [menuGroup, setMenuGroup] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("0");
  const [available, setAvailable] = useState(true);
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.products), where("sellerId", "==", sellerId));
    return onSnapshot(q, (snap) => {
      const list: SellerProduct[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setRows(list);
    });
  }, [sellerId]);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.menus), where("sellerId", "==", sellerId));
    return onSnapshot(q, (snap) => {
      const list: SellerMenu[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setMenus(list);
    });
  }, [sellerId]);

  function openAdd() {
    setModal({ mode: "add" });
    setName("");
    setMenuGroup("");
    setPrice("");
    setQty("0");
    setAvailable(true);
    setImageUrl("");
  }

  function openEdit(p: SellerProduct) {
    setModal({ mode: "edit", p });
    setName(String(p.name ?? ""));
    setMenuGroup(String(p.menuGroup ?? p.category ?? ""));
    setPrice(String(p.price ?? ""));
    const qv = coerceQty(p.qty ?? p.quantity ?? p.stock);
    setQty(String(qv));
    setAvailable(Boolean(p.available !== false));
    setImageUrl(String(p.imageUrl ?? p.photoUrl ?? p.image ?? ""));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const priceN = Math.max(0, Number(price) || 0);
    const qtyN = coerceQty(qty);
    const avail = qtyN <= 0 ? false : available;
    const mg = menuGroup.trim();

    setBusy(true);
    try {
      if (modal?.mode === "add") {
        await addDoc(collection(db, COLLECTIONS.products), {
          sellerId,
          name: name.trim(),
          menuGroup: mg || undefined,
          category: mg || undefined,
          price: priceN,
          qty: qtyN,
          quantity: qtyN,
          available: avail,
          imageUrl: imageUrl.trim() || undefined,
          createdAt: serverTimestamp(),
        });
      } else if (modal?.mode === "edit" && modal.p) {
        await updateDoc(doc(db, COLLECTIONS.products, modal.p.id), {
          name: name.trim(),
          menuGroup: mg || null,
          category: mg || null,
          price: priceN,
          qty: qtyN,
          quantity: qtyN,
          available: avail,
          imageUrl: imageUrl.trim() || null,
        });
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: SellerProduct) {
    if (!window.confirm(`Remove product “${p.name ?? p.id}”?`)) return;
    setBusy(true);
    try {
      const urls = [p.imageUrl, p.photoUrl, typeof p.image === "string" ? p.image : ""].filter(Boolean) as string[];
      for (const u of urls) await deleteStorageFileIfUrl(u);
      await deleteDoc(doc(db, COLLECTIONS.products, p.id));
    } finally {
      setBusy(false);
    }
  }

  async function onUploadImage(file: File, target: SellerProduct | "new") {
    setBusy(true);
    try {
      const path = `products/${sellerId}/${Date.now()}-${file.name.replace(/\s/g, "_")}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      if (target === "new") {
        setImageUrl(url);
      } else {
        if (target.imageUrl) await deleteStorageFileIfUrl(target.imageUrl);
        await updateDoc(doc(db, COLLECTIONS.products, target.id), { imageUrl: url });
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailable(p: SellerProduct, next: boolean) {
    const qtyN = coerceQty(p.qty ?? p.quantity ?? p.stock);
    const patch: Record<string, unknown> = { available: qtyN <= 0 ? false : next };
    await updateDoc(doc(db, COLLECTIONS.products, p.id), patch);
  }

  return (
    <Card title="Products">
      <div className="btn-row" style={{ marginBottom: "0.75rem", justifyContent: "flex-start" }}>
        <Button type="button" onClick={() => openAdd()} disabled={busy}>
          Add product
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Menu group</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Available</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const qn = coerceQty(p.qty ?? p.quantity ?? p.stock);
              const av = qn <= 0 ? false : p.available !== false;
              return (
                <tr key={p.id}>
                  <td className="cell-strong">{p.name ?? "—"}</td>
                  <td>{p.menuGroup ?? p.category ?? "—"}</td>
                  <td>{String(p.price ?? "—")}</td>
                  <td>{String(qn)}</td>
                  <td>
                    <span className="pill">{av ? "ON" : "OFF"}</span>
                  </td>
                  <td className="actions-cell">
                    <div className="btn-row">
                      <Button variant="ghost" className="btn--compact" disabled={busy} onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button variant="ghost" className="btn--compact" disabled={busy || qn <= 0} onClick={() => void toggleAvailable(p, !av)}>
                        {av ? "Off" : "On"}
                      </Button>
                      <Button variant="danger" className="btn--compact" disabled={busy} onClick={() => void remove(p)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="muted small">No products yet.</p> : null}
      </div>

      <Modal
        open={!!modal}
        title={modal?.mode === "add" ? "Add product" : "Edit product"}
        onClose={() => !busy && setModal(null)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" form="product-form" disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <form id="product-form" className="stack" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Menu group</span>
            <input className="input" value={menuGroup} onChange={(e) => setMenuGroup(e.target.value)} list="product-menu-dl" />
            <datalist id="product-menu-dl">
              {menus.map((m) => (
                <option key={m.id} value={m.name ?? ""} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Price</span>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </label>
          <label className="field">
            <span>Quantity</span>
            <input
              className="input"
              inputMode="numeric"
              value={qty}
              onChange={(e) => {
                const v = e.target.value;
                setQty(v);
                const n = coerceQty(v);
                if (n <= 0) setAvailable(false);
              }}
              required
            />
          </label>
          <label className="field" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={available} disabled={coerceQty(qty) <= 0} onChange={(e) => setAvailable(e.target.checked)} />
            <span>Available</span>
          </label>
          <label className="field">
            <span>Image URL (optional)</span>
            <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          </label>
          <label className="btn btn--ghost" style={{ cursor: "pointer", width: "fit-content" }}>
            Upload image
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                const t = modal?.mode === "edit" ? modal.p : "new";
                if (f) void onUploadImage(f, t);
                e.target.value = "";
              }}
            />
          </label>
          {imageUrl ? <img className="img-preview" src={imageUrl} alt="" style={{ maxHeight: 120 }} /> : null}
        </form>
      </Modal>
    </Card>
  );
}
