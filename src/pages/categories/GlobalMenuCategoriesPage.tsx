import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../../firebase";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import {
  archiveGlobalMenuCategory,
  COLLECTIONS,
  countProductsUsingGlobalMenuCategory,
  isGlobalMenuCategorySlugTaken,
  slugifyCategoryName,
} from "../../services/adminFirestore";
import type { GlobalCuisineCategory, GlobalMenuCategory } from "../../types/models";

async function ensureUniqueMenuSlug(base: string, excludeId?: string): Promise<string> {
  let s = slugifyCategoryName(base);
  let n = 0;
  for (;;) {
    const taken = await isGlobalMenuCategorySlugTaken(s, excludeId);
    if (!taken) return s;
    n += 1;
    s = `${slugifyCategoryName(base)}-${n}`;
  }
}

export function GlobalMenuCategoriesPage() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [menus, setMenus] = useState<GlobalMenuCategory[]>([]);
  const [cuisines, setCuisines] = useState<GlobalCuisineCategory[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; row: GlobalMenuCategory }>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [cuisinePick, setCuisinePick] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.globalMenuCategories), (snap) => {
      const list: GlobalMenuCategory[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setMenus(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.globalCuisineCategories), (snap) => {
      const list: GlobalCuisineCategory[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setCuisines(list);
    });
  }, []);

  const cuisineOptions = useMemo(
    () => cuisines.filter((c) => !c.deletedAt && c.active !== false),
    [cuisines]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menus.filter((r) => {
      if (!showArchived && r.deletedAt) return false;
      if (!q) return true;
      const blob = [r.name, r.slug, r.id, ...(r.cuisineIds ?? [])].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [menus, search, showArchived]);

  const cuisineLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cuisines) m.set(c.id, c.name ?? c.slug ?? c.id);
    return m;
  }, [cuisines]);

  useEffect(() => {
    if (modal?.mode !== "add" || slugTouched) return;
    setSlug(slugifyCategoryName(name));
  }, [name, modal?.mode, slugTouched]);

  function openAdd() {
    setModal({ mode: "add" });
    setName("");
    setSlug("");
    setSlugTouched(false);
    setCuisinePick(new Set());
  }

  function openEdit(row: GlobalMenuCategory) {
    setModal({ mode: "edit", row });
    setName(String(row.name ?? ""));
    setSlug(String(row.slug ?? ""));
    setSlugTouched(true);
    setCuisinePick(new Set(row.cuisineIds ?? []));
  }

  function toggleCuisine(id: string) {
    setCuisinePick((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const nextSlug = await ensureUniqueMenuSlug(slug.trim() || slugifyCategoryName(n), modal?.mode === "edit" ? modal.row.id : undefined);
      const ids = [...cuisinePick];
      if (modal?.mode === "add") {
        const max = menus.filter((r) => !r.deletedAt).reduce((mx, r) => Math.max(mx, r.sortOrder ?? 0), 0);
        await addDoc(collection(db, COLLECTIONS.globalMenuCategories), {
          name: n,
          slug: nextSlug,
          cuisineIds: ids,
          active: true,
          sortOrder: max + 1,
          createdAt: serverTimestamp(),
        });
      } else if (modal?.mode === "edit" && modal.row) {
        await updateDoc(doc(db, COLLECTIONS.globalMenuCategories, modal.row.id), {
          name: n,
          slug: nextSlug,
          cuisineIds: ids,
          updatedAt: serverTimestamp(),
        });
      }
      setModal(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: GlobalMenuCategory) {
    if (r.deletedAt) return;
    const on = r.active !== false;
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.globalMenuCategories, r.id), {
        active: !on,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function moveSort(r: GlobalMenuCategory, dir: -1 | 1) {
    if (r.deletedAt) return;
    const pool = menus.filter((x) => !x.deletedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const idx = pool.findIndex((x) => x.id === r.id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= pool.length) return;
    const a = pool[idx];
    const b = pool[swapIdx];
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, COLLECTIONS.globalMenuCategories, a.id), { sortOrder: b.sortOrder ?? 0, updatedAt: serverTimestamp() });
      batch.update(doc(db, COLLECTIONS.globalMenuCategories, b.id), { sortOrder: a.sortOrder ?? 0, updatedAt: serverTimestamp() });
      await batch.commit();
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(r: GlobalMenuCategory) {
    const cnt = await countProductsUsingGlobalMenuCategory(r.id);
    if (cnt > 0) {
      if (
        !window.confirm(
          `“${r.name ?? r.id}” is referenced by ${cnt} product(s) (globalMenuCategoryId). The category will be archived (soft delete) so IDs stay valid. Continue?`
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await archiveGlobalMenuCategory(r.id);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!window.confirm(`Permanently delete “${r.name ?? r.id}”? No products reference this id.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.globalMenuCategories, r.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="Menu categories"
        actions={
          <div className="btn-row">
            <Button type="button" onClick={() => openAdd()} disabled={busy}>
              Add menu category
            </Button>
            <Link className="btn btn--ghost" to={`${base}/categories/linking`}>
              Cuisine map
            </Link>
          </div>
        }
      >
        <div className="category-toolbar">
          <label className="field field--inline-grow" style={{ marginBottom: 0 }}>
            <span className="muted small">Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, slug, cuisine id…" />
          </label>
          <label className="field field--inline" style={{ marginBottom: 0, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="muted small">Show archived</span>
          </label>
        </div>
        <p className="muted small">
          Collection <span className="mono">{COLLECTIONS.globalMenuCategories}</span>. Link rows to cuisines for seller dropdown filtering.
        </p>
        <div className="table-wrap">
          <table className="data-table data-table--enterprise">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Slug</th>
                <th>Linked cuisines</th>
                <th>Status</th>
                <th className="actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="small">
                    <Button variant="ghost" className="btn--compact" disabled={busy || !!r.deletedAt} onClick={() => void moveSort(r, -1)}>
                      ↑
                    </Button>
                    <Button variant="ghost" className="btn--compact" disabled={busy || !!r.deletedAt} onClick={() => void moveSort(r, 1)}>
                      ↓
                    </Button>
                  </td>
                  <td className="cell-strong">{r.name ?? "—"}</td>
                  <td className="mono small">{r.slug ?? "—"}</td>
                  <td className="muted small cell-clamp">
                    {(r.cuisineIds ?? []).length
                      ? (r.cuisineIds ?? []).map((id) => cuisineLabel.get(id) ?? id).join(" · ")
                      : "—"}
                  </td>
                  <td>
                    {r.deletedAt ? (
                      <span className="pill pill--muted">Archived</span>
                    ) : r.active === false ? (
                      <span className="pill pill--muted">Inactive</span>
                    ) : (
                      <span className="pill pill--live">Active</span>
                    )}
                  </td>
                  <td className="actions-cell">
                    <div className="seller-actions">
                      <Button variant="ghost" className="btn--compact" disabled={busy || !!r.deletedAt} onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        disabled={busy || !!r.deletedAt}
                        onClick={() => void toggleActive(r)}
                      >
                        {r.active === false ? "Activate" : "Deactivate"}
                      </Button>
                      <Button
                        variant="danger"
                        className="btn--compact"
                        disabled={busy || !!r.deletedAt}
                        onClick={() => void removeRow(r)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? <p className="muted small">No rows match.</p> : null}
      </Card>

      <Modal
        open={!!modal}
        title={modal?.mode === "add" ? "Add menu category" : "Edit menu category"}
        onClose={() => !busy && setModal(null)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" form="global-menu-cat-form" disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <form id="global-menu-cat-form" className="stack" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span>Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Dosas" />
          </label>
          <label className="field">
            <span>Slug</span>
            <input
              className="input mono"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="dosas"
            />
          </label>
          <fieldset className="form-fieldset">
            <legend className="form-legend">Linked cuisines</legend>
            <p className="muted small" style={{ marginTop: 0 }}>
              Choose which cuisines include this menu category in seller apps.
            </p>
            <div className="category-checkbox-grid">
              {cuisineOptions.map((c) => (
                <label key={c.id} className="field field--inline">
                  <input type="checkbox" checked={cuisinePick.has(c.id)} onChange={() => toggleCuisine(c.id)} />
                  <span>{c.name ?? c.slug}</span>
                </label>
              ))}
            </div>
            {cuisineOptions.length === 0 ? <p className="muted small">Add active cuisines first.</p> : null}
          </fieldset>
        </form>
      </Modal>
    </>
  );
}
