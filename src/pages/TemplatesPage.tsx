import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../firebase";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import type { DiscountTemplate, MessageTemplate } from "../types/models";

type Tab = "messages" | "discounts";

export function TemplatesPage() {
  const [tab, setTab] = useState<Tab>("messages");
  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [discounts, setDiscounts] = useState<DiscountTemplate[]>([]);
  const [editingMsg, setEditingMsg] = useState<MessageTemplate | null>(null);
  const [editingDisc, setEditingDisc] = useState<DiscountTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setEditingMsg(null);
    setEditingDisc(null);
    setCreating(false);
  }, [tab]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "messageTemplates"), (snap) => {
      const list: MessageTemplate[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setMessages(list);
    });
    const u2 = onSnapshot(collection(db, "discountTemplates"), (snap) => {
      const list: DiscountTemplate[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as DocumentData) }));
      setDiscounts(list);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Templates</h1>
          <p className="muted">Collections: messageTemplates, discountTemplates</p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
            if (tab === "messages") {
              setEditingDisc(null);
              setEditingMsg({ id: "", title: "", body: "" });
            } else {
              setEditingMsg(null);
              setEditingDisc({ id: "", title: "", code: "", percentOff: 10 });
            }
          }}
        >
          New template
        </Button>
      </header>

      <div className="tabs">
        <button type="button" className={`tab${tab === "messages" ? " tab--active" : ""}`} onClick={() => setTab("messages")}>
          Message templates
        </button>
        <button type="button" className={`tab${tab === "discounts" ? " tab--active" : ""}`} onClick={() => setTab("discounts")}>
          Discount templates
        </button>
      </div>

      {tab === "messages" ? (
        <Card title="messageTemplates">
          <ul className="template-list">
            {messages.map((m) => (
              <li key={m.id} className="template-item">
                <div>
                  <div className="cell-strong">{m.title ?? "Untitled"}</div>
                  <p className="muted small clamp-2">{m.body ?? ""}</p>
                </div>
                <div className="btn-row">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCreating(false);
                      setEditingMsg(m);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm("Delete this template?")) void deleteDoc(doc(db, "messageTemplates", m.id));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card title="discountTemplates">
          <ul className="template-list">
            {discounts.map((d) => (
              <li key={d.id} className="template-item">
                <div>
                  <div className="cell-strong">{d.title ?? "Untitled"}</div>
                  <p className="muted small">
                    Code <code className="code">{d.code ?? "—"}</code> · {d.percentOff ?? 0}% off
                  </p>
                </div>
                <div className="btn-row">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCreating(false);
                      setEditingDisc(d);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm("Delete this template?")) void deleteDoc(doc(db, "discountTemplates", d.id));
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TemplateMessageModal
        open={Boolean(
          editingMsg && (creating ? !editingMsg.id : Boolean(editingMsg.id))
        )}
        initial={editingMsg}
        onClose={() => {
          setCreating(false);
          setEditingMsg(null);
        }}
      />

      <TemplateDiscountModal
        open={Boolean(
          editingDisc && (creating ? !editingDisc.id : Boolean(editingDisc.id))
        )}
        initial={editingDisc}
        onClose={() => {
          setCreating(false);
          setEditingDisc(null);
        }}
      />
    </div>
  );
}

function TemplateMessageModal({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: MessageTemplate | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title ?? "");
    setBody(initial.body ?? "");
  }, [initial]);

  async function save() {
    if (!initial) return;
    setBusy(true);
    try {
      if (!initial.id) {
        await addDoc(collection(db, "messageTemplates"), {
          title,
          body,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "messageTemplates", initial.id), {
          title,
          body,
          updatedAt: serverTimestamp(),
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!open || !initial) return null;

  return (
    <Modal
      open={open}
      title={initial.id ? "Edit message template" : "New message template"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Body</span>
        <textarea className="input input--area" value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
      </label>
    </Modal>
  );
}

function TemplateDiscountModal({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: DiscountTemplate | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setTitle(initial.title ?? "");
    setCode(initial.code ?? "");
    setPercent(String(initial.percentOff ?? 10));
  }, [initial]);

  async function save() {
    if (!initial) return;
    setBusy(true);
    try {
      const percentOff = Math.max(0, Math.min(100, Number(percent)));
      if (!initial.id) {
        await addDoc(collection(db, "discountTemplates"), {
          title,
          code,
          percentOff,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "discountTemplates", initial.id), {
          title,
          code,
          percentOff,
          updatedAt: serverTimestamp(),
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!open || !initial) return null;

  return (
    <Modal
      open={open}
      title={initial.id ? "Edit discount template" : "New discount template"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Code</span>
        <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label className="field">
        <span>Percent off</span>
        <input className="input" value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="numeric" />
      </label>
    </Modal>
  );
}
