import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAdminSession } from "../contexts/AdminSessionContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

function postLoginPath(role: "admin" | "super_admin", from?: string | null): string {
  if (from && from !== "/login") return from;
  return role === "super_admin" ? "/super-admin" : "/admin/fafo";
}

export function LoginPage() {
  const { admin, login, loading } = useAdminSession();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!loading && admin) {
    return <Navigate to={postLoginPath(admin.role, from)} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(phone, password);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell shell--center login-wrap">
      <Card title="FaFo Admin" className="login-card">
        <p className="muted login-lead">
          Sign in with the phone and password from your <code className="code">admins</code> document in
          Firestore.
        </p>
        <form className="stack" onSubmit={(e) => void onSubmit(e)}>
          <label className="field">
            <span>Phone</span>
            <input
              className="input"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {err ? <p className="error-text">{err}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
