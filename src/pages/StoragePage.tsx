import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { COLLECTIONS, collectProductImageUrls, deleteStorageFileIfUrl } from "../services/adminFirestore";
import type { Seller } from "../types/models";

type Row = {
  id: string;
  kind: "seller_shop" | "seller_qr" | "product";
  label: string;
  url: string;
  sellerId?: string;
  productId?: string;
  field: string;
};

export function StoragePage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [products, setProducts] = useState<{ id: string; data: DocumentData }[]>([]);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    const u2 = onSnapshot(collection(db, COLLECTIONS.products), (snap) => {
      const list: { id: string; data: DocumentData }[] = [];
      snap.forEach((d) => list.push({ id: d.id, data: d.data() as DocumentData }));
      setProducts(list);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const s of sellers) {
      const shop = s.shopImageUrl?.trim();
      if (shop)
        out.push({
          id: `${s.id}-shop`,
          kind: "seller_shop",
          label: `${s.shopName ?? s.id} · shop`,
          url: shop,
          sellerId: s.id,
          field: "shopImageUrl",
        });
      const qr = s.qrImageUrl?.trim();
      if (qr)
        out.push({
          id: `${s.id}-qr`,
          kind: "seller_qr",
          label: `${s.shopName ?? s.id} · QR`,
          url: qr,
          sellerId: s.id,
          field: "qrImageUrl",
        });
    }
    for (const p of products) {
      const urls = collectProductImageUrls(p.data);
      const title = String(p.data.name ?? p.data.title ?? p.id);
      const sid = String(p.data.sellerId ?? "");
      for (let i = 0; i < urls.length; i++) {
        out.push({
          id: `${p.id}-img-${i}`,
          kind: "product",
          label: `${title} · image ${i + 1}${sid ? ` · ${sid}` : ""}`,
          url: urls[i]!,
          sellerId: sid || undefined,
          productId: p.id,
          field: `image[${i}]`,
        });
      }
    }
    return out;
  }, [sellers, products]);

  async function removeRow(r: Row) {
    setBusyUrl(r.url);
    try {
      if (r.kind === "product" && r.productId) {
        const ref = doc(db, COLLECTIONS.products, r.productId);
        const snap = products.find((x) => x.id === r.productId);
        if (!snap) return;
        const d = snap.data;
        const patch: Record<string, unknown> = {};
        if (d.imageUrl === r.url) patch.imageUrl = deleteField();
        if (d.photoUrl === r.url) patch.photoUrl = deleteField();
        if (d.image === r.url) patch.image = deleteField();
        if (Array.isArray(d.images)) {
          const next = (d.images as unknown[]).filter((u) => u !== r.url);
          if (next.length !== d.images.length) patch.images = next;
        }
        if (Object.keys(patch).length) await updateDoc(ref, patch);
      } else if (r.sellerId && (r.kind === "seller_shop" || r.kind === "seller_qr")) {
        await updateDoc(doc(db, COLLECTIONS.sellers, r.sellerId), { [r.field]: deleteField() });
      }
      await deleteStorageFileIfUrl(r.url);
    } finally {
      setBusyUrl(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Storage</h1>
          <p className="muted">Shop images, product photos, and QR files linked from seller and product records. Removing an asset deletes the file and clears the link.</p>
        </div>
      </header>

      <Card>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Preview</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No images found on sellers/products.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="cell-strong">{r.label}</div>
                      <div className="muted small">
                        {r.kind} · {r.field}
                      </div>
                    </td>
                    <td style={{ width: "100px" }}>
                      <img src={r.url} alt="" className="img-preview" style={{ maxHeight: "56px", objectFit: "cover" }} />
                    </td>
                    <td className="small cell-clamp">
                      <span className="mono" title={r.url}>
                        {r.url.slice(0, 72)}…
                      </span>
                    </td>
                    <td>
                      <Button variant="danger" disabled={busyUrl === r.url} onClick={() => void removeRow(r)}>
                        {busyUrl === r.url ? "…" : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
