import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, ref } from "firebase/storage";
import { db, storage } from "../firebase";

export const COLLECTIONS = {
  admins: "admins",
  sellers: "sellers",
  users: "users",
  products: "products",
  orders: "orders",
  billing: "billing",
  billingLogs: "billingLogs",
  settings: "settings",
  /** Seller app promos / banners */
  ads: "ads",
  /** impression + click events (kind field) */
  adClicks: "adClicks",
  /** Seller menu groups (Breakfast, Lunch, …) + product ids */
  menus: "menus",
};

export const SETTINGS_GLOBAL_ID = "global";

export function tsToDate(v) {
  if (v == null) return null;
  try {
    if (typeof v === "string") return new Date(v);
    if (typeof v.toDate === "function") return v.toDate();
    return null;
  } catch {
    return null;
  }
}

export function isOrderCompleted(status) {
  const s = (status ?? "").toLowerCase();
  return s === "completed" || s === "delivered" || s === "paid" || s === "done";
}

export function isOrderCancelled(status) {
  const s = (status ?? "").toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "refunded";
}

export function isOrderPending(status) {
  const s = (status ?? "").toLowerCase();
  return s === "pending" || s === "placed" || s === "received" || s === "new";
}

export function isTrialActive(seller) {
  const end = tsToDate(seller.trialEnd);
  if (!end) return false;
  return end.getTime() > Date.now();
}

export function sellerUiState(seller) {
  if (seller.isBlocked) return "blocked";
  if (isTrialActive(seller)) return "trial";
  const slots = Number(seller.slots ?? 0);
  if (seller.isLive && slots > 0) return "live";
  if (!isTrialActive(seller) && slots <= 0) return "expired";
  if (slots > 0) return "live";
  return "offline";
}

/** blocked | suspended | live | trial | demo — for admin dashboard + badges */
export function sellerOperationalCategory(seller) {
  if (seller.isBlocked) return "blocked";
  const sm = (seller.sellerMode ?? "").toLowerCase();
  if (sm === "suspended") return "suspended";
  if (sm === "live") return "live";
  if (sm === "freeTrial") return "trial";
  if (seller.trialHidden && seller.isLive && Number(seller.slots ?? 0) > 0) return "live";
  if (isTrialActive(seller) && !seller.trialHidden) return "trial";
  if (seller.isLive && Number(seller.slots ?? 0) > 0) return "live";
  return "demo";
}

export function sellerDisplayLabel(seller) {
  const cat = sellerOperationalCategory(seller);
  const labels = {
    blocked: "Blocked",
    suspended: "Suspended",
    live: "Live",
    trial: "Trial",
    demo: "Demo",
  };
  return labels[cat] ?? "Demo";
}

async function appendBillingLog(entry) {
  await addDoc(collection(db, COLLECTIONS.billingLogs), {
    ...entry,
    createdAt: serverTimestamp(),
  });
}

/**
 * Full go live: slots + optional recharge, suppress trial, set live mode.
 * If startImmediately is false: only adds slots + balance (mode unchanged).
 */
export async function adminGoLive(input) {
  const { sellerId, slotsToAdd, rechargeAmount, notes, startImmediately, adminId } = input;
  const slotsAdded = Math.max(1, Math.floor(Number(slotsToAdd)));
  const recharge = Math.max(0, Number(rechargeAmount ?? 0));

  if (startImmediately === false) {
    const ref = doc(db, COLLECTIONS.sellers, sellerId);
    const patch = { slots: increment(slotsAdded) };
    if (recharge > 0) {
      patch.currentAvailableBalance = increment(recharge);
      patch.walletBalance = increment(recharge);
    }
    await updateDoc(ref, patch);
    await appendBillingLog({
      sellerId,
      action: "ADD_SLOTS",
      slotsAdded,
      amountAdded: recharge,
      adminId: adminId ?? "",
      notes: notes ?? "",
      startImmediately: false,
    });
    return;
  }

  await runTransaction(db, async (tx) => {
    const sref = doc(db, COLLECTIONS.sellers, sellerId);
    const snap = await tx.get(sref);
    if (!snap.exists()) throw new Error("Seller not found");
    const d = snap.data();
    const hadHistory = Boolean(d.hasLiveHistory);
    const billingState = hadHistory ? "liveReturn" : "liveFirstTime";

    const sellerUpdate = {
      sellerMode: "live",
      sellerBillingState: billingState,
      isLive: true,
      hasLiveHistory: true,
      slots: increment(slotsAdded),
      activatedAt: serverTimestamp(),
      trialHidden: true,
      trialExpired: true,
      trialSuppressed: true,
    };
    if (recharge > 0) {
      sellerUpdate.currentAvailableBalance = increment(recharge);
      sellerUpdate.walletBalance = increment(recharge);
    }
    tx.update(sref, sellerUpdate);
  });

  await appendBillingLog({
    sellerId,
    action: "GO_LIVE",
    slotsAdded,
    amountAdded: recharge,
    adminId: adminId ?? "",
    notes: notes ?? "",
    startImmediately: true,
  });
}

/** Add slots only; optional auto-activate full live (same fields as Go Live, no extra recharge). */
export async function adminAddSlotsWithOptionalLive(input) {
  const { sellerId, slotsToAdd, autoActivateLive, adminId, notes } = input;
  const n = Math.max(1, Math.floor(Number(slotsToAdd)));
  if (autoActivateLive) {
    await adminGoLive({
      sellerId,
      slotsToAdd: n,
      rechargeAmount: 0,
      notes: notes ?? "",
      startImmediately: true,
      adminId,
    });
    return;
  }
  const ref = doc(db, COLLECTIONS.sellers, sellerId);
  await updateDoc(ref, { slots: increment(n) });
  await appendBillingLog({
    sellerId,
    action: "ADD_SLOTS",
    slotsAdded: n,
    amountAdded: 0,
    adminId: adminId ?? "",
    notes: notes ?? "",
    startImmediately: false,
    autoActivateLive: false,
  });
}

export async function adminPutOnTrial(input) {
  const { sellerId, trialDays } = input;
  const days = Math.max(1, Math.floor(Number(trialDays) || 7));
  const start = Timestamp.now();
  const end = Timestamp.fromMillis(start.toMillis() + days * 86400000);
  await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), {
    sellerMode: "freeTrial",
    sellerBillingState: "freeTrial",
    isLive: false,
    trialStart: start,
    trialEnd: end,
    trialHidden: false,
    trialExpired: false,
    trialSuppressed: false,
  });
}

export async function adminSuspendSeller(sellerId) {
  await updateDoc(doc(db, COLLECTIONS.sellers, sellerId), {
    sellerMode: "suspended",
    isLive: false,
  });
}

/**
 * First two letters A–Z from shop name + 4 digits (e.g. CA1832).
 * If fewer than 2 letters: SHOP + 4 digits (e.g. SHOP4021).
 * @param {string} [shopName]
 */
export function shopCodePrefixFromShopName(shopName) {
  const letters = String(shopName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return "SHOP";
}

/**
 * @param {string} [shopName] Used to derive prefix; uniqueness checked in Firestore.
 */
/**
 * @param {string} code
 * @param {string} [excludeSellerId] seller doc id to ignore (editing same seller)
 * @returns {Promise<boolean>} true if another seller already uses this code
 */
export async function isShopCodeTaken(code, excludeSellerId) {
  const c = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!c) return false;
  const q = query(collection(db, COLLECTIONS.sellers), where("shopCode", "==", c), limit(5));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    if (excludeSellerId && d.id === excludeSellerId) continue;
    return true;
  }
  return false;
}

/** Admin-facing subscription gate: ACTIVE / EXPIRED / BLOCKED */
export function sellerBillingAccessLabel(seller) {
  if (seller?.isBlocked) return "BLOCKED";
  if (seller?.sellingEnabled === false) return "EXPIRED";
  return "ACTIVE";
}

export async function generateUniqueShopCode(shopName) {
  const prefix = shopCodePrefixFromShopName(shopName);
  const maxAttempts = 80;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const code = `${prefix}${digits}`;
    const q = query(collection(db, COLLECTIONS.sellers), where("shopCode", "==", code), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return code;
  }
  for (let k = 0; k < 30; k++) {
    const digits = String((Date.now() + k * 7919 + Math.floor(Math.random() * 997)) % 10000).padStart(4, "0");
    const code = `${prefix}${digits}`;
    const q = query(collection(db, COLLECTIONS.sellers), where("shopCode", "==", code), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return code;
  }
  throw new Error("Could not generate a unique shop code; try again.");
}

/**
 * Assigns shopCode to every seller document that is missing it.
 * @returns {Promise<number>} Count of sellers updated.
 */
export async function backfillMissingShopCodes() {
  const snap = await getDocs(collection(db, COLLECTIONS.sellers));
  let batch = writeBatch(db);
  let inBatch = 0;
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const sc = data.shopCode;
    if (sc != null && String(sc).trim() !== "") continue;
    const code = await generateUniqueShopCode(data.shopName ?? "");
    batch.update(doc(db, COLLECTIONS.sellers, d.id), { shopCode: code });
    inBatch++;
    updated++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      inBatch = 0;
    }
  }
  if (inBatch > 0) await batch.commit();
  return updated;
}

/**
 * Approve billing: grant slots, set live, credit wallet by payment amount (if any).
 */
export async function approveBillingRecord(b) {
  if (!b.sellerId) throw new Error("Billing record has no sellerId.");
  const rowStatus = (b.status ?? "pending").toLowerCase();
  if (rowStatus !== "pending") throw new Error("Only pending billing rows can be approved.");

  await runTransaction(db, async (tx) => {
    const billRef = doc(db, COLLECTIONS.billing, b.id);
    const sellerRef = doc(db, COLLECTIONS.sellers, b.sellerId);
    const snap = await tx.get(billRef);
    if (!snap.exists()) throw new Error("Billing doc missing");
    const data = snap.data();
    const st = ((data.status ?? "pending") + "").toLowerCase();
    if (st !== "pending") return;
    const sellerSnap = await tx.get(sellerRef);
    if (!sellerSnap.exists()) throw new Error("Seller not found for billing record");

    const packageValue = Math.max(1, Math.floor(Number(data.packageValue ?? 10)));
    const amount = Math.max(0, Number(data.amount ?? 0));

    const sellerUpdate = {
      slots: increment(packageValue),
      isLive: true,
    };
    if (amount > 0) {
      sellerUpdate.walletBalance = increment(amount);
    }

    tx.update(billRef, { status: "approved", processedAt: serverTimestamp() });
    tx.update(sellerRef, sellerUpdate);
  });
}

export async function rejectBillingRecord(id, note) {
  await updateDoc(doc(db, COLLECTIONS.billing, id), {
    status: "rejected",
    adminNote: note ?? "",
    processedAt: serverTimestamp(),
  });
}

export async function deleteSellerProducts(sellerId) {
  const q = query(collection(db, COLLECTIONS.products), where("sellerId", "==", sellerId));
  const snap = await getDocs(q);
  let n = 0;
  const batchSize = 400;
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count += 1;
    n += 1;
    if (count >= batchSize) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  return n;
}

export async function deleteSellerOrders(sellerId) {
  const q = query(collection(db, COLLECTIONS.orders), where("sellerId", "==", sellerId));
  const snap = await getDocs(q);
  let n = 0;
  const batchSize = 400;
  let batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count += 1;
    n += 1;
    if (count >= batchSize) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  return n;
}

export async function deleteStorageFileIfUrl(url) {
  if (!url?.trim()) return;
  try {
    await deleteObject(ref(storage, url.trim()));
  } catch {
    /* invalid URL or already deleted */
  }
}

export function ordersForSeller(orders, sellerId) {
  return orders.filter((o) => o.sellerId === sellerId);
}

export function aggregateOrders(orders) {
  let total = 0;
  let pending = 0;
  let completed = 0;
  let cancelled = 0;
  let revenue = 0;
  let todayRev = 0;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (const o of orders) {
    total += 1;
    if (isOrderPending(o.status)) pending += 1;
    if (isOrderCompleted(o.status)) {
      completed += 1;
      const amt = Number(o.total ?? 0);
      revenue += amt;
      const created = tsToDate(o.createdAt);
      if (created && created >= startOfToday) todayRev += amt;
    }
    if (isOrderCancelled(o.status)) cancelled += 1;
  }
  return { total, pending, completed, cancelled, revenue, todayRev };
}

export function toCsvRow(cells) {
  return cells
    .map((c) => {
      const s = String(c ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

export function downloadTextFile(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function createManualBillingSlotRequest(input) {
  await addDoc(collection(db, COLLECTIONS.billing), {
    sellerId: input.sellerId,
    amount: input.amount ?? 0,
    packageValue: Math.max(1, Math.floor(Number(input.packageValue ?? 1))),
    status: "pending",
    source: "admin_manual",
    adminNote: input.note ?? "",
    createdAt: serverTimestamp(),
  });
}

/** Trend buckets + top shops/buyers for dashboard/analytics */
export function buildTrendMetrics(orders, sellers) {
  const sellerRevenue = new Map();
  const buyerSpend = new Map();
  const buyerOrderCount = new Map();
  const dayBuckets = new Map();

  for (const o of orders) {
    const created = tsToDate(o.createdAt);
    const ms = created ? created.getTime() : 0;
    const dayKey = ms ? new Date(ms).toISOString().slice(0, 10) : "";

    if (dayKey) {
      const b = dayBuckets.get(dayKey) ?? { orders: 0, revenue: 0 };
      b.orders += 1;
      if (isOrderCompleted(o.status)) b.revenue += Number(o.total ?? 0);
      dayBuckets.set(dayKey, b);
    }

    const bpAll = (o.buyerPhone ?? "").trim();
    if (bpAll) {
      buyerOrderCount.set(bpAll, (buyerOrderCount.get(bpAll) ?? 0) + 1);
    }
    if (isOrderCompleted(o.status)) {
      const sid = o.sellerId ?? "";
      if (sid) sellerRevenue.set(sid, (sellerRevenue.get(sid) ?? 0) + Number(o.total ?? 0));
      const bp = (o.buyerPhone ?? "").trim();
      if (bp) buyerSpend.set(bp, (buyerSpend.get(bp) ?? 0) + Number(o.total ?? 0));
    }
  }

  const last14 = [...dayBuckets.keys()].sort().slice(-14);
  const orderTrend = last14.map((k) => ({ label: k.slice(5), value: dayBuckets.get(k)?.orders ?? 0 }));
  const revenueTrend = last14.map((k) => ({
    label: k.slice(5),
    value: Math.round(dayBuckets.get(k)?.revenue ?? 0),
  }));

  const topShops = [...sellerRevenue.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, value]) => {
      const name = sellers.find((s) => s.id === id)?.shopName ?? id;
      return { label: String(name).slice(0, 18), value: Math.round(value) };
    });

  const topBuyers = [...buyerSpend.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phone, value]) => ({ label: phone.slice(-10), value: Math.round(value) }));

  const repeatBuyers = [...buyerOrderCount.values()].filter((n) => n > 1).length;

  return { orderTrend, revenueTrend, topShops, topBuyers, repeatBuyers };
}

/** Approved billing: sum of amounts and sum of slot packages */
export function aggregateApprovedBilling(rows) {
  let approvedAmount = 0;
  let slotsSold = 0;
  for (const r of rows) {
    const st = (r.status ?? "").toLowerCase();
    if (st !== "approved") continue;
    approvedAmount += Number(r.amount ?? 0);
    slotsSold += Math.max(0, Math.floor(Number(r.packageValue ?? 0)));
  }
  return { approvedAmount, slotsSold };
}

export function collectProductImageUrls(data) {
  const urls = [];
  const push = (u) => {
    if (typeof u === "string" && u.startsWith("http")) urls.push(u);
  };
  push(data.imageUrl);
  push(data.photoUrl);
  push(data.image);
  if (Array.isArray(data.images)) for (const x of data.images) push(x);
  if (data.media && typeof data.media === "object") {
    for (const v of Object.values(data.media)) push(v);
  }
  return [...new Set(urls)];
}
