import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../../firebase";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { COLLECTIONS } from "../../services/adminFirestore";
import type { GlobalCuisineCategory, GlobalMenuCategory } from "../../types/models";

/**
 * Cuisine-centric editor: for one cuisine, toggle which global menu categories include it (updates cuisineIds on each menu row).
 */
export function CategoryLinkingPage() {
  const [cuisines, setCuisines] = useState<GlobalCuisineCategory[]>([]);
  const [menus, setMenus] = useState<GlobalMenuCategory[]>([]);
  const [selectedCuisineId, setSelectedCuisineId] = useState<string>("");
  const [pick, setPick] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.globalCuisineCategories), (snap) => {
      const list: GlobalCuisineCategory[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setCuisines(list);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, COLLECTIONS.globalMenuCategories), (snap) => {
      const list: GlobalMenuCategory[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
      setMenus(list);
    });
  }, []);

  const activeCuisines = useMemo(
    () => cuisines.filter((c) => !c.deletedAt && c.active !== false),
    [cuisines]
  );

  const activeMenus = useMemo(() => menus.filter((m) => !m.deletedAt), [menus]);

  useEffect(() => {
    if (!selectedCuisineId) {
      setPick(new Set());
      setDirty(false);
      return;
    }
    const next = new Set<string>();
    for (const m of menus) {
      if ((m.cuisineIds ?? []).includes(selectedCuisineId)) next.add(m.id);
    }
    setPick(next);
    setDirty(false);
  }, [selectedCuisineId, menus]);

  function toggleMenu(menuId: string) {
    setPick((prev) => {
      const n = new Set(prev);
      if (n.has(menuId)) n.delete(menuId);
      else n.add(menuId);
      return n;
    });
    setDirty(true);
  }

  async function saveLinks() {
    if (!selectedCuisineId) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const cid = selectedCuisineId;
      for (const m of activeMenus) {
        const had = (m.cuisineIds ?? []).includes(cid);
        const want = pick.has(m.id);
        if (had === want) continue;
        const cur = Array.isArray(m.cuisineIds) ? [...m.cuisineIds] : [];
        let nextIds: string[];
        if (want) nextIds = cur.includes(cid) ? cur : [...cur, cid];
        else nextIds = cur.filter((x) => x !== cid);
        batch.update(doc(db, COLLECTIONS.globalMenuCategories, m.id), {
          cuisineIds: nextIds,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setDirty(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const selectedName = activeCuisines.find((c) => c.id === selectedCuisineId)?.name ?? selectedCuisineId;

  return (
    <Card
      title="Cuisine map"
      actions={
        <Button type="button" disabled={busy || !dirty || !selectedCuisineId} onClick={() => void saveLinks()}>
          Save links
        </Button>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Pick a cuisine, then choose which <strong>menu categories</strong> apply (e.g. South Indian → Dosas, Idli, Filter Coffee). This
        updates <span className="mono">cuisineIds</span> on each <span className="mono">{COLLECTIONS.globalMenuCategories}</span>{" "}
        document — seller apps see changes on the next snapshot.
      </p>
      <label className="field">
        <span>Cuisine</span>
        <select className="input" value={selectedCuisineId} onChange={(e) => setSelectedCuisineId(e.target.value)}>
          <option value="">Select…</option>
          {activeCuisines.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.slug} ({c.slug})
            </option>
          ))}
        </select>
      </label>

      {selectedCuisineId ? (
        <>
          <h3 className="category-map__subtitle">Menu categories for {selectedName}</h3>
          <div className="category-checkbox-grid category-checkbox-grid--boxed">
            {activeMenus.map((m) => (
              <label key={m.id} className="field field--inline">
                <input type="checkbox" checked={pick.has(m.id)} onChange={() => toggleMenu(m.id)} disabled={m.active === false} />
                <span>
                  {m.name ?? m.slug}
                  {m.active === false ? <span className="muted small"> (inactive)</span> : null}
                </span>
              </label>
            ))}
          </div>
          {activeMenus.length === 0 ? <p className="muted small">No menu categories yet.</p> : null}
        </>
      ) : (
        <p className="muted small">Select a cuisine to edit its menu links.</p>
      )}
    </Card>
  );
}
