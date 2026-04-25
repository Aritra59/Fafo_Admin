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
  archiveGlobalCuisineCategory,
  COLLECTIONS,
  isGlobalCuisineSlugTaken,
  listGlobalMenuCategoriesLinkedToCuisine,
  slugifyCategoryName,
} from "../../services/adminFirestore";
import type { GlobalCuisineCategory } from "../../types/models";

async function ensureUniqueCuisineSlug(base: string, excludeId?: string): Promise<string> {
  let s = slugifyCategoryName(base);
  let n = 0;
  for (;;) {
    const taken = await isGlobalCuisineSlugTaken(s, excludeId);
    if (!taken) return s;
    n += 1;
    s = `${slugifyCategoryName(base)}-${n}`;
  }
}

export function GlobalCuisineCategoriesPage() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [rows, setRows] = useState<GlobalCuisineCategory[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; row: GlobalCuisineCategory }>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.globalCuisineCategories), (snap) => {
      const list: GlobalCuisineCategory[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setRows(list);
    });
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showArchived && r.deletedAt) return false;
      if (!q) return true;
      const blob = [r.name, r.slug, r.id].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search, showArchived]);

  const activeLiveCount = useMemo(() => rows.filter((r) => r.active !== false && !r.deletedAt).length, [rows]);

  useEffect(() => {
    if (modal?.mode !== "add" || slugTouched) return;
    setSlug(slugifyCategoryName(name));
  }, [name, modal?.mode, slugTouched]);

  function openAdd() {
    setModal({ mode: "add" });
    setName("");
    setSlug("");
    setSlugTouched(false);
  }

  function openEdit(row: GlobalCuisineCategory) {
    setModal({ mode: "edit", row });
    setName(String(row.name ?? ""));
    setSlug(String(row.slug ?? ""));
    setSlugTouched(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const nextSlug = await ensureUniqueCuisineSlug(slug.trim() || slugifyCategoryName(n), modal?.mode === "edit" ? modal.row.id : undefined);
      if (modal?.mode === "add") {
        const max = rows.filter((r) => !r.deletedAt).reduce((mx, r) => Math.max(mx, r.sortOrder ?? 0), 0);
        await addDoc(collection(db, COLLECTIONS.globalCuisineCategories), {
          name: n,
          slug: nextSlug,
          active: true,
          sortOrder: max + 1,
          createdAt: serverTimestamp(),
        });
      } else if (modal?.mode === "edit" && modal.row) {
        await updateDoc(doc(db, COLLECTIONS.globalCuisineCategories, modal.row.id), {
          name: n,
          slug: nextSlug,
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

  async function toggleActive(r: GlobalCuisineCategory) {
    if (r.deletedAt) return;
    const on = r.active !== false;
    setBusy(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.globalCuisineCategories, r.id), {
        active: !on,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setBusy(false);
    }
  }

  async function moveSort(r: GlobalCuisineCategory, dir: -1 | 1) {
    if (r.deletedAt) return;
    const pool = rows.filter((x) => !x.deletedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const idx = pool.findIndex((x) => x.id === r.id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= pool.length) return;
    const a = pool[idx];
    const b = pool[swapIdx];
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, COLLECTIONS.globalCuisineCategories, a.id), { sortOrder: b.sortOrder ?? 0, updatedAt: serverTimestamp() });
      batch.update(doc(db, COLLECTIONS.globalCuisineCategories, b.id), { sortOrder: a.sortOrder ?? 0, updatedAt: serverTimestamp() });
      await batch.commit();
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(r: GlobalCuisineCategory) {
    const linked = await listGlobalMenuCategoriesLinkedToCuisine(r.id);
    if (linked.length > 0) {
      const names = linked.map((x) => x.name ?? x.id).join(", ");
      if (
        !window.confirm(
          `“${r.name ?? r.id}” is linked from menu categories: ${names}.\n\nArchive will unlink all menu mappings and hide this cuisine. Continue?`
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await archiveGlobalCuisineCategory(r.id);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!window.confirm(`Permanently delete “${r.name ?? r.id}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.globalCuisineCategories, r.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="Cuisine categories"
        actions={
          <div className="btn-row">
            <Button type="button" onClick={() => openAdd()} disabled={busy}>
              Add cuisine
            </Button>
            <Link className="btn btn--ghost" to={base}>
              Dashboard
            </Link>
          </div>
        }
      >
        <div className="category-toolbar">
          <label className="field field--inline-grow" style={{ marginBottom: 0 }}>
            <span className="muted small">Search</span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, slug, id…"
            />
          </label>
          <label className="field field--inline" style={{ marginBottom: 0, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="muted small">Show archived</span>
          </label>
        </div>
        <p className="muted small">
          Collection <span className="mono">{COLLECTIONS.globalCuisineCategories}</span> · {activeLiveCount} active (non-archived)
        </p>
        <div className="table-wrap">
          <table className="data-table data-table--enterprise">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Slug</th>
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
        title={modal?.mode === "add" ? "Add cuisine" : "Edit cuisine"}
        onClose={() => !busy && setModal(null)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" form="global-cuisine-form" disabled={busy}>
              Save
            </Button>
          </>
        }
      >
        <form id="global-cuisine-form" className="stack" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span>Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="South Indian" />
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
              placeholder="south-indian"
            />
            <span className="muted small">URL-safe id for apps. Auto-filled from name until you edit it.</span>
          </label>
        </form>
      </Modal>
    </>
  );
}
