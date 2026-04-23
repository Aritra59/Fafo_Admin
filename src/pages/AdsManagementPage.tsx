import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { COLLECTIONS, deleteStorageFileIfUrl, sellerOperationalCategory } from "../services/adminFirestore";
import { formatDate } from "../lib/format";
import type { FafoAd, Seller } from "../types/models";

type SellerFilter = "all" | "live" | "trial" | "blocked" | "city";
type ModalMode = "create" | "edit";

function tsFromInput(s: string): Timestamp | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function inputFromTs(ts: unknown): string {
  if (ts == null) return "";
  let dt: Date | null = null;
  try {
    if (typeof ts === "string") dt = new Date(ts);
    else if (typeof (ts as { toDate?: () => Date }).toDate === "function") dt = (ts as { toDate: () => Date }).toDate();
  } catch {
    dt = null;
  }
  if (!dt || Number.isNaN(dt.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

function readPlacementHome(ad: FafoAd): boolean {
  if (typeof ad.placementHome === "boolean") return ad.placementHome;
  if (ad.placements?.includes("seller_home")) return true;
  if (ad.placement === "seller_home") return true;
  return false;
}

function readPlacementDashboard(ad: FafoAd): boolean {
  if (typeof ad.placementDashboard === "boolean") return ad.placementDashboard;
  if (ad.placements?.includes("seller_dashboard")) return true;
  if (ad.placement === "seller_dashboard") return true;
  return false;
}

function readBannerDashboard(ad: FafoAd): string {
  const u = (ad.bannerUrlDashboard ?? "").trim();
  if (u) return u;
  const urls = ad.bannerUrls?.filter((x) => typeof x === "string" && x.trim()) as string[] | undefined;
  if (urls?.length && readPlacementDashboard(ad) && !readPlacementHome(ad)) return urls[0];
  const single = (ad.bannerImageUrl ?? "").trim();
  if (single && readPlacementDashboard(ad)) return single;
  return "";
}

function readBannerHome(ad: FafoAd): string {
  const u = (ad.bannerUrlHome ?? "").trim();
  if (u) return u;
  const urls = ad.bannerUrls?.filter((x) => typeof x === "string" && x.trim()) as string[] | undefined;
  if (urls?.length && readPlacementHome(ad)) return urls[urls.length > 1 ? 1 : 0] ?? "";
  return "";
}

function readTargetSellerId(ad: FafoAd): { all: boolean; id: string } {
  const raw = (ad.targetSellerId ?? "").trim();
  if (raw === "all" || raw === "") {
    if (ad.targetSellerIds?.length === 1) return { all: false, id: ad.targetSellerIds[0] };
    if (ad.targetSellerIds && ad.targetSellerIds.length > 1) return { all: false, id: ad.targetSellerIds[0] };
    if (ad.audience === "seller_specific" && ad.targetSellerIds?.length) return { all: false, id: ad.targetSellerIds[0] };
    return { all: true, id: "" };
  }
  return { all: false, id: raw };
}

function listPreviewImages(ad: FafoAd): string[] {
  const a = readBannerDashboard(ad);
  const b = readBannerHome(ad);
  return [a, b].filter(Boolean);
}

function placementSummary(ad: FafoAd): string {
  const h = readPlacementHome(ad);
  const d = readPlacementDashboard(ad);
  const bits: string[] = [];
  if (d) bits.push("Dashboard");
  if (h) bits.push("Home");
  if (bits.length) return bits.join(" · ");
  if (ad.placement === "buyer_explore" || ad.placements?.includes("buyer_explore")) return "Buyer explore (legacy)";
  return "—";
}

function audienceSummary(ad: FafoAd, sellers: Seller[]): string {
  const { all, id } = readTargetSellerId(ad);
  if (all) return "All sellers";
  const name = sellers.find((s) => s.id === id)?.shopName;
  return name ? `${name}` : `Shop ${id}`;
}

/** Strip keys whose value is undefined (Firestore rejects undefined). */
function withoutUndefined<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, unknown>;
}

export function AdsManagementPage() {
  const { appName } = useParams();
  const base = `/admin/${appName ?? "fafo"}`;
  const [ads, setAds] = useState<FafoAd[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [statsByAd, setStatsByAd] = useState<Record<string, { impressions: number; clicks: number; reach: number }>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [ctaLink, setCtaLink] = useState("");
  const [active, setActive] = useState(true);
  const [priority, setPriority] = useState("0");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [placementHome, setPlacementHome] = useState(false);
  const [placementDashboard, setPlacementDashboard] = useState(true);
  const [targetAllSellers, setTargetAllSellers] = useState(true);
  const [specificSellerId, setSpecificSellerId] = useState("");
  const [bannerUrlDashboard, setBannerUrlDashboard] = useState("");
  const [bannerUrlHome, setBannerUrlHome] = useState("");
  const [pendingDashboardFile, setPendingDashboardFile] = useState<File | null>(null);
  const [pendingHomeFile, setPendingHomeFile] = useState<File | null>(null);

  const [sellerSearch, setSellerSearch] = useState("");
  const [sellerFilter, setSellerFilter] = useState<SellerFilter>("all");
  const [cityFilter, setCityFilter] = useState("");

  useEffect(() => {
    const u = onSnapshot(collection(db, COLLECTIONS.ads), (snap) => {
      const list: FafoAd[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => {
        const pa = Number(a.priority ?? 0);
        const pb = Number(b.priority ?? 0);
        if (pb !== pa) return pb - pa;
        const ta = (a.updatedAt as { seconds?: number } | undefined)?.seconds ?? (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const tb = (b.updatedAt as { seconds?: number } | undefined)?.seconds ?? (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return tb - ta;
      });
      setAds(list);
    });
    const u2 = onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    return () => {
      u();
      u2();
    };
  }, []);

  const sortedAds = useMemo(() => ads, [ads]);

  const sellersForSelect = useMemo(() => {
    const q = sellerSearch.trim().toLowerCase();
    const filtered = sellers.filter((s) => {
      if (sellerFilter === "live" && sellerOperationalCategory(s) !== "live") return false;
      if (sellerFilter === "trial" && sellerOperationalCategory(s) !== "trial") return false;
      if (sellerFilter === "blocked" && !s.isBlocked) return false;
      if (sellerFilter === "city") {
        const c = (cityFilter || "").trim().toLowerCase();
        if (!c) return false;
        if (!String(s.locationCity ?? "").toLowerCase().includes(c)) return false;
      }
      if (!q) return true;
      const blob = [s.shopName, s.ownerName, s.phone, s.shopCode, s.id].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
    return [...filtered].sort((a, b) => String(a.shopName ?? "").localeCompare(String(b.shopName ?? "")));
  }, [sellers, sellerSearch, sellerFilter, cityFilter]);

  const cityOptions = useMemo(() => {
    const s = new Set<string>();
    for (const x of sellers) {
      const c = x.locationCity?.trim();
      if (c) s.add(c);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [sellers]);

  const refreshStats = useCallback(async (list: FafoAd[]) => {
    if (!list.length) {
      setStatsByAd({});
      return;
    }
    setStatsLoading(true);
    try {
      const next: Record<string, { impressions: number; clicks: number; reach: number }> = {};
      for (const ad of list) {
        const impQ = query(collection(db, COLLECTIONS.adClicks), where("adId", "==", ad.id), where("kind", "==", "impression"));
        const clkQ = query(collection(db, COLLECTIONS.adClicks), where("adId", "==", ad.id), where("kind", "==", "click"));
        const [impSnap, clkSnap] = await Promise.all([getCountFromServer(impQ), getCountFromServer(clkQ)]);
        const impressions = impSnap.data().count;
        const clicks = clkSnap.data().count;
        const sampleQ = query(collection(db, COLLECTIONS.adClicks), where("adId", "==", ad.id), where("kind", "==", "impression"), limit(2000));
        const sample = await getDocs(sampleQ);
        const reached = new Set<string>();
        sample.forEach((d) => {
          const data = d.data() as DocumentData;
          const key = (data.buyerId as string | undefined) || (data.sellerId as string | undefined) || "";
          if (key) reached.add(key);
        });
        next[ad.id] = { impressions, clicks, reach: reached.size };
      }
      setStatsByAd(next);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStats(ads);
  }, [ads, refreshStats]);

  function openCreate() {
    setModalMode("create");
    setEditingId(null);
    setErr(null);
    setTitle("");
    setSubtitle("");
    setCtaLink("");
    setActive(true);
    setPriority("0");
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    setStartInput(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`);
    const end = new Date(now.getTime() + 14 * 86400000);
    setEndInput(`${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}T${p(end.getHours())}:${p(end.getMinutes())}`);
    setPlacementHome(false);
    setPlacementDashboard(true);
    setTargetAllSellers(true);
    setSpecificSellerId("");
    setBannerUrlDashboard("");
    setBannerUrlHome("");
    setPendingDashboardFile(null);
    setPendingHomeFile(null);
    setSellerSearch("");
    setSellerFilter("all");
    setCityFilter("");
    setModalOpen(true);
  }

  function openEdit(ad: FafoAd) {
    setModalMode("edit");
    setEditingId(ad.id);
    setErr(null);
    setTitle(ad.title ?? "");
    setSubtitle(ad.subtitle ?? "");
    setCtaLink(ad.ctaLink ?? "");
    setActive(ad.active !== false);
    setPriority(String(ad.priority ?? 0));
    setStartInput(inputFromTs(ad.startAt));
    setEndInput(inputFromTs(ad.endAt));
    setPlacementHome(readPlacementHome(ad));
    setPlacementDashboard(readPlacementDashboard(ad));
    const tgt = readTargetSellerId(ad);
    setTargetAllSellers(tgt.all);
    setSpecificSellerId(tgt.id);
    setBannerUrlDashboard(readBannerDashboard(ad));
    setBannerUrlHome(readBannerHome(ad));
    setPendingDashboardFile(null);
    setPendingHomeFile(null);
    setSellerSearch("");
    setSellerFilter("all");
    setCityFilter("");
    setModalOpen(true);
  }

  async function uploadAsset(adId: string, file: File): Promise<string> {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `ads/${adId}/asset-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, "")}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    return getDownloadURL(r);
  }

  async function deleteAllStorageForAd(ad: FafoAd) {
    const urls = new Set<string>();
    for (const u of [ad.bannerUrlDashboard, ad.bannerUrlHome, ad.bannerImageUrl, ...(ad.bannerUrls ?? [])]) {
      const t = (u ?? "").trim();
      if (t) urls.add(t);
    }
    for (const u of urls) await deleteStorageFileIfUrl(u);
  }

  async function deleteAdEvents(adId: string) {
    for (;;) {
      const snap = await getDocs(query(collection(db, COLLECTIONS.adClicks), where("adId", "==", adId), limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  async function removeAd(ad: FafoAd) {
    if (!window.confirm(`Delete this campaign? Analytics rows will be removed.`)) return;
    setBusy(true);
    try {
      await deleteAllStorageForAd(ad);
      await deleteAdEvents(ad.id);
      await deleteDoc(doc(db, COLLECTIONS.ads, ad.id));
    } finally {
      setBusy(false);
    }
  }

  async function saveAd(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const ph = Boolean(placementHome);
    const pd = Boolean(placementDashboard);
    if (!ph && !pd) {
      setErr("Select at least one placement: Seller Dashboard and/or Seller Home.");
      return;
    }

    const startAt = tsFromInput(startInput);
    const endAt = tsFromInput(endInput);
    if (!startAt || !endAt) {
      setErr("Start and end are required.");
      return;
    }
    if (endAt.toMillis() <= startAt.toMillis()) {
      setErr("End must be after start.");
      return;
    }

    const t = title.trim();
    if (!t) {
      setErr("Campaign title is required.");
      return;
    }

    let dashUrl = bannerUrlDashboard.trim();
    let homeUrl = bannerUrlHome.trim();

    if (pd && !dashUrl && !pendingDashboardFile) {
      setErr("Dashboard placement requires a dashboard banner image.");
      return;
    }
    if (ph && !homeUrl && !pendingHomeFile) {
      setErr("Home placement requires a home banner image.");
      return;
    }

    const allTargets = Boolean(targetAllSellers);
    const sid = specificSellerId.trim();
    if (!allTargets && !sid) {
      setErr("Select a seller, or choose “All sellers”.");
      return;
    }

    const targetSellerId: string = allTargets ? "all" : sid;
    const pri = Math.max(0, Math.floor(Number(priority) || 0));

    setBusy(true);
    try {
      if (modalMode === "edit" && !editingId) throw new Error("Missing campaign id");
      const newRef = modalMode === "create" ? doc(collection(db, COLLECTIONS.ads)) : null;
      const adId = modalMode === "create" ? newRef!.id : editingId!;

      if (pendingDashboardFile) dashUrl = await uploadAsset(adId, pendingDashboardFile);
      if (pendingHomeFile) homeUrl = await uploadAsset(adId, pendingHomeFile);

      const st = subtitle.trim();

      const core: Record<string, unknown> = {
        active: Boolean(active),
        title: t,
        ctaLink: ctaLink.trim(),
        placementDashboard: pd,
        placementHome: ph,
        bannerUrlDashboard: dashUrl,
        bannerUrlHome: homeUrl,
        targetSellerId,
        priority: pri,
        startAt,
        endAt,
        updatedAt: serverTimestamp(),
      };

      const legacyStrip: Record<string, unknown> = {
        placement: deleteField(),
        placements: deleteField(),
        audience: deleteField(),
        targetSellerIds: deleteField(),
        targetBuyerIds: deleteField(),
        bannerUrls: deleteField(),
        bannerImageUrl: deleteField(),
        targetMode: deleteField(),
        ctaText: deleteField(),
      };

      if (modalMode === "create" && newRef) {
        const payload: Record<string, unknown> = {
          ...core,
          createdAt: serverTimestamp(),
        };
        if (st) payload.subtitle = st;
        await setDoc(newRef, withoutUndefined(payload));
      } else {
        const patch: Record<string, unknown> = { ...core, ...legacyStrip };
        if (st) patch.subtitle = st;
        else patch.subtitle = deleteField();
        await updateDoc(doc(db, COLLECTIONS.ads, adId), withoutUndefined(patch));
      }

      const logSafe = {
        active: Boolean(active),
        title: t,
        subtitle: st || null,
        ctaLink: ctaLink.trim(),
        placementDashboard: pd,
        placementHome: ph,
        bannerUrlDashboard: dashUrl,
        bannerUrlHome: homeUrl,
        targetSellerId,
        priority: pri,
        startAt: startAt.toDate().toISOString(),
        endAt: endAt.toDate().toISOString(),
        updatedAt: "serverTimestamp()",
        createdAt: modalMode === "create" ? "serverTimestamp()" : "(existing)",
      };
      console.log("Saved ad", logSafe);

      setModalOpen(false);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page--wide ads-page">
      <header className="page-head page-head--split">
        <div>
          <p className="page-kicker">Marketing</p>
          <h1 className="page-title">Seller ads</h1>
          <p className="page-lead muted">Campaigns for seller dashboard and seller home. Saved in a normalized shape the seller app can read.</p>
        </div>
        <div className="btn-row">
          <Button type="button" onClick={() => openCreate()} disabled={busy}>
            New campaign
          </Button>
          <Button type="button" variant="ghost" onClick={() => void refreshStats(ads)} disabled={statsLoading}>
            {statsLoading ? "Refreshing…" : "Refresh metrics"}
          </Button>
          <Link className="btn btn--ghost" to={base}>
            Overview
          </Link>
        </div>
      </header>

      <div className="ads-grid">
        {sortedAds.map((ad) => {
          const st = statsByAd[ad.id] ?? { impressions: 0, clicks: 0, reach: 0 };
          const ctr = st.impressions > 0 ? ((st.clicks / st.impressions) * 100).toFixed(1) : "0";
          const imgs = listPreviewImages(ad);
          return (
            <article key={ad.id} className="ads-campaign-card ads-campaign-card--saas">
              <div className="ads-campaign-card__media">
                {imgs.length ? (
                  <div className="ads-campaign-card__strip">
                    {imgs.map((u) => (
                      <img key={u} src={u} alt="" className="ads-campaign-card__thumb" />
                    ))}
                  </div>
                ) : (
                  <div className="ads-campaign-card__empty">No banner</div>
                )}
              </div>
              <div className="ads-campaign-card__body">
                <div className="ads-campaign-card__top">
                  <span className="ads-priority">P{ad.priority ?? 0}</span>
                  <span className={`ads-status${ad.active !== false ? " ads-status--on" : ""}`}>{ad.active !== false ? "Active" : "Off"}</span>
                </div>
                <h2 className="ads-campaign-card__title">{ad.title?.trim() || "Untitled"}</h2>
                <p className="ads-campaign-card__meta muted small">
                  {placementSummary(ad)} · {audienceSummary(ad, sellers)}
                </p>
                <p className="ads-campaign-card__dates muted small">
                  {formatDate(ad.startAt)} — {formatDate(ad.endAt)}
                </p>
                <div className="ads-campaign-card__stats">
                  <span>{st.impressions} imp</span>
                  <span>{st.clicks} clk</span>
                  <span>{ctr}% CTR</span>
                  <span>{st.reach} reach</span>
                </div>
                <div className="ads-campaign-card__actions">
                  <Button variant="ghost" className="btn--compact" disabled={busy} onClick={() => openEdit(ad)}>
                    Edit
                  </Button>
                  <Button variant="danger" className="btn--compact" disabled={busy} onClick={() => void removeAd(ad)}>
                    Delete
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {sortedAds.length === 0 ? <p className="muted small" style={{ marginTop: "1rem" }}>No campaigns yet.</p> : null}

      <Card title="Performance">
        <div className="table-wrap">
          <table className="data-table data-table--enterprise ads-table-saas">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Priority</th>
                <th>Placements</th>
                <th>Target</th>
                <th>Impr.</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Reach</th>
              </tr>
            </thead>
            <tbody>
              {sortedAds.map((ad) => {
                const st = statsByAd[ad.id] ?? { impressions: 0, clicks: 0, reach: 0 };
                const ctr = st.impressions > 0 ? ((st.clicks / st.impressions) * 100).toFixed(1) : "0";
                return (
                  <tr key={`row-${ad.id}`}>
                    <td className="cell-strong">{ad.title?.trim() || ad.id}</td>
                    <td>{ad.priority ?? 0}</td>
                    <td className="muted small">{placementSummary(ad)}</td>
                    <td className="muted small">{audienceSummary(ad, sellers)}</td>
                    <td>{st.impressions}</td>
                    <td>{st.clicks}</td>
                    <td>{ctr}%</td>
                    <td>{st.reach}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? "New seller ad" : "Edit seller ad"}
        onClose={() => !busy && setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="ad-seller-form" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form id="ad-seller-form" className="stack form-stack" onSubmit={(e) => void saveAd(e)}>
          {err ? <div className="form-alert form-alert--error">{err}</div> : null}

          <label className="field field--compact">
            <span>Campaign title</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ayur" required />
          </label>
          <label className="field field--compact">
            <span>Subtitle (optional)</span>
            <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </label>
          <label className="field field--compact">
            <span>CTA link</span>
            <input className="input" value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} placeholder="https://…" />
          </label>

          <div className="split-2">
            <label className="field field--compact">
              <span>Start</span>
              <input className="input" type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} required />
            </label>
            <label className="field field--compact">
              <span>End</span>
              <input className="input" type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} required />
            </label>
          </div>
          <label className="field field--compact">
            <span>Priority</span>
            <input className="input" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
          <label className="field field--inline">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active</span>
          </label>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Placements</legend>
            <label className="field field--inline">
              <input type="checkbox" checked={placementDashboard} onChange={(e) => setPlacementDashboard(e.target.checked)} />
              <span>Seller dashboard</span>
            </label>
            <label className="field field--inline">
              <input type="checkbox" checked={placementHome} onChange={(e) => setPlacementHome(e.target.checked)} />
              <span>Seller home</span>
            </label>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Banners</legend>
            <label className="field field--compact">
              <span>Dashboard banner image</span>
              <input
                type="file"
                accept="image/*"
                className="input"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPendingDashboardFile(f);
                  e.target.value = "";
                }}
              />
              {pendingDashboardFile ? (
                <span className="muted small">New file: {pendingDashboardFile.name}</span>
              ) : bannerUrlDashboard ? (
                <div className="ads-form-preview">
                  <img src={bannerUrlDashboard} alt="" />
                </div>
              ) : null}
            </label>
            <label className="field field--compact">
              <span>Home banner image</span>
              <input
                type="file"
                accept="image/*"
                className="input"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPendingHomeFile(f);
                  e.target.value = "";
                }}
              />
              {pendingHomeFile ? (
                <span className="muted small">New file: {pendingHomeFile.name}</span>
              ) : bannerUrlHome ? (
                <div className="ads-form-preview">
                  <img src={bannerUrlHome} alt="" />
                </div>
              ) : null}
            </label>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend className="form-legend">Target</legend>
            <label className="field field--inline">
              <input type="radio" name="ad-target" checked={targetAllSellers} onChange={() => setTargetAllSellers(true)} />
              <span>All sellers</span>
            </label>
            <label className="field field--inline">
              <input type="radio" name="ad-target" checked={!targetAllSellers} onChange={() => setTargetAllSellers(false)} />
              <span>Specific seller</span>
            </label>
            {!targetAllSellers ? (
              <div className="form-panel" style={{ marginTop: "0.75rem" }}>
                <label className="field field--compact">
                  <span className="muted small">Search shops</span>
                  <input className="input" value={sellerSearch} onChange={(e) => setSellerSearch(e.target.value)} placeholder="Name, phone, code…" />
                </label>
                <div className="filter-chips" style={{ marginBottom: "0.5rem" }}>
                  {(
                    [
                      ["all", "All"],
                      ["live", "Live"],
                      ["trial", "Trial"],
                      ["blocked", "Blocked"],
                      ["city", "City"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`filter-chip${sellerFilter === id ? " filter-chip--on" : ""}`}
                      onClick={() => setSellerFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {sellerFilter === "city" ? (
                  <label className="field field--compact">
                    <span>City</span>
                    <input className="input" list="ads-city-dl2" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} />
                    <datalist id="ads-city-dl2">
                      {cityOptions.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                ) : null}
                <label className="field field--compact">
                  <span>Seller</span>
                  <select className="input" value={specificSellerId} onChange={(e) => setSpecificSellerId(e.target.value)} required={!targetAllSellers}>
                    <option value="">Select seller…</option>
                    {sellersForSelect.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shopName ?? s.id} · {s.shopCode ?? s.phone ?? s.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}
