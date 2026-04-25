import { useEffect, useMemo, useState } from "react";
import { collection, doc, increment, onSnapshot, updateDoc, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import {
  approveBillingRecord,
  COLLECTIONS,
  rejectBillingRecord,
  tsToDate,
} from "../services/adminFirestore";
import { formatMoney, formatDate } from "../lib/format";
import type { BillingLogEntry, BillingRecord, Seller } from "../types/models";

type LogTab = "all" | "topups" | "deductions" | "slots";

function logBucket(entry: BillingLogEntry): Exclude<LogTab, "all"> {
  const amt = Number(entry.amountAdded ?? 0);
  const act = (entry.action ?? "").toUpperCase();
  if (amt > 0) return "topups";
  if (amt < 0 || /DEDUCT|WITHDRAW|DEBIT|CHARGE|FEE/.test(act)) return "deductions";
  return "slots";
}

export function BillingPage() {
  const [rows, setRows] = useState<BillingRecord[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [logs, setLogs] = useState<BillingLogEntry[]>([]);
  const [logTab, setLogTab] = useState<LogTab>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectRow, setRejectRow] = useState<BillingRecord | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [noteRow, setNoteRow] = useState<BillingRecord | null>(null);
  const [noteText, setNoteText] = useState("");
  const [manualRow, setManualRow] = useState<BillingRecord | null>(null);
  const [manualSlots, setManualSlots] = useState("10");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, COLLECTIONS.billing), (snap) => {
      const list: BillingRecord[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return tb - ta;
      });
      setRows(list);
    });
    const u2 = onSnapshot(collection(db, COLLECTIONS.sellers), (snap) => {
      const list: Seller[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setSellers(list);
    });
    const u3 = onSnapshot(collection(db, COLLECTIONS.billingLogs), (snap) => {
      const list: BillingLogEntry[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      list.sort((a, b) => {
        const da = tsToDate(a.createdAt as never)?.getTime() ?? 0;
        const dbi = tsToDate(b.createdAt as never)?.getTime() ?? 0;
        return dbi - da;
      });
      setLogs(list.slice(0, 500));
    });
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const sellerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sellers) m.set(s.id, s.shopName ?? s.ownerName ?? s.id);
    return m;
  }, [sellers]);

  const filteredLogs = useMemo(() => {
    if (logTab === "all") return logs;
    return logs.filter((e) => logBucket(e) === logTab);
  }, [logs, logTab]);

  async function approve(b: BillingRecord) {
    setBusyId(b.id);
    try {
      await approveBillingRecord(b);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejectRow) return;
    setBusyId(rejectRow.id);
    try {
      await rejectBillingRecord(rejectRow.id, rejectNote);
      setRejectRow(null);
      setRejectNote("");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote() {
    if (!noteRow) return;
    setBusyId(noteRow.id);
    try {
      await updateDoc(doc(db, COLLECTIONS.billing, noteRow.id), { adminNote: noteText.trim() });
      setNoteRow(null);
    } finally {
      setBusyId(null);
    }
  }

  async function manualAddSlots() {
    if (!manualRow?.sellerId) return;
    const n = Math.max(1, Math.floor(Number(manualSlots) || 1));
    setBusyId(manualRow.id);
    try {
      await updateDoc(doc(db, COLLECTIONS.sellers, manualRow.sellerId), {
        slots: increment(n),
        isLive: true,
      });
      await updateDoc(doc(db, COLLECTIONS.billing, manualRow.id), {
        adminNote: `${manualRow.adminNote ?? ""}\n[admin] Added ${n} slots manually`.trim(),
      });
      setManualRow(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Billing / Slots</h1>
          <p className="muted">Approve payments, reject with a note, or add slots manually. Wallet activity streams from billing logs.</p>
        </div>
      </header>

      <Card title="Pending payment proofs">
        <div className="table-wrap">
          <table className="data-table data-table--enterprise">
            <thead>
              <tr>
                <th>Seller</th>
                <th>Amount</th>
                <th>Package</th>
                <th>Screenshot</th>
                <th>Status</th>
                <th>Note</th>
                <th>Created</th>
                <th className="actions-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="cell-strong">{sellerName.get(b.sellerId ?? "") ?? "—"}</div>
                    <div className="muted mono small">{b.sellerId ?? "—"}</div>
                  </td>
                  <td>{formatMoney(Number(b.amount))}</td>
                  <td className="small">
                    <div>{b.packageName ?? "—"}</div>
                    <div className="muted">Slots: {b.packageValue ?? "—"}</div>
                  </td>
                  <td>
                    {b.screenshotUrl ? (
                      <a className="link-inline" href={b.screenshotUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className="pill">{b.status ?? "—"}</span>
                  </td>
                  <td className="cell-clamp small">{b.adminNote ?? "—"}</td>
                  <td className="muted small">{formatDate(b.createdAt)}</td>
                  <td className="actions-cell">
                    <div className="seller-actions">
                      <Button
                        variant="primary"
                        className="btn--compact"
                        disabled={busyId === b.id || (b.status ?? "pending").toLowerCase() !== "pending"}
                        onClick={() => void approve(b)}
                      >
                        {busyId === b.id ? "…" : "Approve"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        disabled={busyId === b.id || (b.status ?? "pending").toLowerCase() !== "pending"}
                        onClick={() => {
                          setRejectRow(b);
                          setRejectNote("");
                        }}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        disabled={busyId === b.id}
                        onClick={() => {
                          setNoteRow(b);
                          setNoteText(b.adminNote ?? "");
                        }}
                      >
                        Note
                      </Button>
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        disabled={busyId === b.id || !b.sellerId}
                        onClick={() => {
                          setManualRow(b);
                          setManualSlots(String(b.packageValue ?? 10));
                        }}
                      >
                        +Slots
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recharge &amp; wallet activity">
        <div className="billing-log-toolbar">
          {(
            [
              ["all", "All"],
              ["topups", "Top-ups"],
              ["deductions", "Deductions"],
              ["slots", "Slots / balance"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`filter-chip${logTab === id ? " filter-chip--on" : ""}`}
              onClick={() => setLogTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="data-table data-table--enterprise data-table--dense">
            <thead>
              <tr>
                <th>When</th>
                <th>Seller</th>
                <th>Kind</th>
                <th>Action</th>
                <th className="numeric">INR</th>
                <th className="numeric">Slots</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((e) => (
                <tr key={e.id}>
                  <td className="muted small">{formatDate(e.createdAt)}</td>
                  <td>
                    <div className="cell-strong small">{sellerName.get(e.sellerId ?? "") ?? "—"}</div>
                    <div className="muted mono small">{e.sellerId ?? "—"}</div>
                  </td>
                  <td>
                    <span className="pill pill--muted">{logBucket(e)}</span>
                  </td>
                  <td className="mono small">{e.action ?? "—"}</td>
                  <td className="numeric small">
                    {Number(e.amountAdded ?? 0) !== 0 ? formatMoney(Number(e.amountAdded)) : "—"}
                  </td>
                  <td className="numeric small">{e.slotsAdded != null ? String(e.slotsAdded) : "—"}</td>
                  <td className="cell-clamp small muted">{e.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredLogs.length === 0 ? <p className="muted small">No log rows in this view.</p> : null}
      </Card>

      <Modal
        open={!!rejectRow}
        title="Reject payment"
        onClose={() => setRejectRow(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void reject()} disabled={busyId != null}>
              Reject
            </Button>
          </>
        }
      >
        <label className="field">
          <span>Reason / note</span>
          <textarea className="input input--area" rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </label>
      </Modal>

      <Modal
        open={!!noteRow}
        title="Admin note"
        onClose={() => setNoteRow(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveNote()} disabled={busyId != null}>
              Save
            </Button>
          </>
        }
      >
        <textarea className="input input--area" rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
      </Modal>

      <Modal
        open={!!manualRow}
        title="Add slots to seller"
        onClose={() => setManualRow(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setManualRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void manualAddSlots()} disabled={busyId != null}>
              Apply
            </Button>
          </>
        }
      >
        <p className="muted small">
          Increments seller slots and sets live. Appends a line to this billing row&apos;s admin note.
        </p>
        <label className="field">
          <span>Slots to add</span>
          <input className="input" value={manualSlots} onChange={(e) => setManualSlots(e.target.value)} inputMode="numeric" />
        </label>
      </Modal>
    </div>
  );
}
