import { useEffect, useState, type FormEvent } from "react";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../../firebase";
import { Card } from "../Card";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { COLLECTIONS } from "../../services/adminFirestore";
import type { SellerMenu, SellerProduct } from "../../types/models";

export function SellerMenusPanel({ sellerId }: { sellerId: string }) {
  const [menus, setMenus] = useState<SellerMenu[]>([]);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; m: SellerMenu }>(null);
  const [menuName, setMenuName] = useState("");
  const [assignOpen, setAssignOpen] = useState<SellerMenu | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.menus), where("sellerId", "==", sellerId));
    return onSnapshot(q, (snap) => {
      const list: SellerMenu[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name)));
      setMenus(list);
    });
  }, [sellerId]);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.products), where("sellerId", "==", sellerId));
    return onSnapshot(q, (snap) => {
      const list: SellerProduct[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setProducts(list);
    });
  }, [sellerId]);

  async function saveMenu(e: FormEvent) {
    e.preventDefault();
    const name = menuName.trim();
    if (!name) return;
    setBusy(true);
    try {
      if (modal?.mode === "add") {
        const max = menus.reduce((mx, m) => Math.max(mx, m.sortOrder ?? 0), 0);
        await addDoc(collection(db, COLLECTIONS.menus), {
          sellerId,
          name,
          sortOrder: max + 1,
          productIds: [],
          createdAt: serverTimestamp(),
        });
      } else if (modal?.mode === "edit" && modal.m) {
        await updateDoc(doc(db, COLLECTIONS.menus, modal.m.id), { name });
      }
      setModal(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeMenu(m: SellerMenu) {
    if (!window.confirm(`Delete menu “${m.name ?? m.id}”? Products stay; only the group is removed.`)) return;
    setBusy(true);
    try {
      const ids = m.productIds ?? [];
      const batch = writeBatch(db);
      for (const pid of ids) {
        const pref = products.find((p) => p.id === pid);
        if (pref && String(pref.menuGroup ?? pref.category ?? "") === String(m.name ?? "")) {
          batch.update(doc(db, COLLECTIONS.products, pid), { menuGroup: deleteField(), category: deleteField() });
        }
      }
      batch.delete(doc(db, COLLECTIONS.menus, m.id));
      await batch.commit();
    } finally {
      setBusy(false);
    }
  }

  async function moveSort(m: SellerMenu, dir: -1 | 1) {
    const cur = m.sortOrder ?? 0;
    const next = cur + dir;
    const swap = menus.find((x) => (x.sortOrder ?? 0) === next);
    setBusy(true);
    try {
      if (swap) {
        const batch = writeBatch(db);
        batch.update(doc(db, COLLECTIONS.menus, m.id), { sortOrder: next });
        batch.update(doc(db, COLLECTIONS.menus, swap.id), { sortOrder: cur });
        await batch.commit();
      } else {
        await updateDoc(doc(db, COLLECTIONS.menus, m.id), { sortOrder: Math.max(0, next) });
      }
    } finally {
      setBusy(false);
    }
  }

  function openAssign(m: SellerMenu) {
    setAssignOpen(m);
    setSelectedProductIds(new Set(m.productIds ?? []));
  }

  async function saveAssign() {
    if (!assignOpen) return;
    const name = String(assignOpen.name ?? "");
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.menus, assignOpen.id), { productIds: [...selectedProductIds] });
      const batch = writeBatch(db);
      for (const p of products) {
        const inMenu = selectedProductIds.has(p.id);
        const matchName = String(p.menuGroup ?? p.category ?? "") === name;
        if (inMenu) {
          batch.update(doc(db, COLLECTIONS.products, p.id), { menuGroup: name, category: name });
        } else if (matchName) {
          batch.update(doc(db, COLLECTIONS.products, p.id), { menuGroup: deleteField(), category: deleteField() });
        }
      }
      await batch.commit();
      setAssignOpen(null);
    } finally {
      setBusy(false);
    }
  }

  function togglePid(id: string) {
    setSelectedProductIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Card title="Menus">
      <p className="muted small" style={{ marginTop: 0 }}>
        Create sections (Breakfast, Lunch, …) and assign products. Product rows use the same name as their menu group for the seller
        catalog.
      </p>
      <div className="btn-row" style={{ marginBottom: "0.75rem", justifyContent: "flex-start" }}>
        <Button
          type="button"
          onClick={() => {
            setModal({ mode: "add" });
            setMenuName("");
          }}
          disabled={busy}
        >
          Add menu
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Name</th>
              <th>Products</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {menus.map((m) => (
              <tr key={m.id}>
                <td className="small">
                  <Button variant="ghost" className="btn--compact" disabled={busy} onClick={() => void moveSort(m, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" className="btn--compact" disabled={busy} onClick={() => void moveSort(m, 1)}>
                    ↓
                  </Button>
                </td>
                <td className="cell-strong">{m.name ?? "—"}</td>
                <td className="muted small">{(m.productIds ?? []).length} linked</td>
                <td className="actions-cell">
                  <div className="btn-row">
                    <Button variant="ghost" className="btn--compact" disabled={busy} onClick={() => openAssign(m)}>
                      Assign products
                    </Button>
                    <Button
                      variant="ghost"
                      className="btn--compact"
                      disabled={busy}
                      onClick={() => {
                        setModal({ mode: "edit", m });
                        setMenuName(String(m.name ?? ""));
                      }}
                    >
                      Rename
                    </Button>
                    <Button variant="danger" className="btn--compact" disabled={busy} onClick={() => void removeMenu(m)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {menus.length === 0 ? <p className="muted small">No menus yet.</p> : null}
      </div>

      <Modal
        open={!!modal}
        title={modal?.mode === "add" ? "Add menu" : "Rename menu"}
        onClose={() => !busy && setModal(null)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" form="menu-form" disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <form id="menu-form" className="stack" onSubmit={(e) => void saveMenu(e)}>
          <label className="field">
            <span>Menu name</span>
            <input className="input" value={menuName} onChange={(e) => setMenuName(e.target.value)} required list="menu-name-hints" />
            <datalist id="menu-name-hints">
              {["Breakfast", "Lunch", "Dinner", "Snacks", "Beverages"].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
        </form>
      </Modal>

      <Modal
        open={!!assignOpen}
        title={assignOpen ? `Assign products — ${assignOpen.name ?? ""}` : "Assign"}
        onClose={() => !busy && setAssignOpen(null)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setAssignOpen(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void saveAssign()}>
              Save assignment
            </Button>
          </>
        }
      >
        <div className="table-wrap" style={{ maxHeight: "280px" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "40px" }} />
                <th>Product</th>
                <th>Menu group on item</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => togglePid(p.id)} />
                  </td>
                  <td className="cell-strong small">{p.name ?? p.id}</td>
                  <td className="muted small">{p.menuGroup ?? p.category ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {products.length === 0 ? <p className="muted small">Add products first.</p> : null}
      </Modal>
    </Card>
  );
}
