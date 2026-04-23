import { useId, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAdminSession } from "../contexts/AdminSessionContext";
import { Button } from "../components/Button";

function postLoginPath(role: "admin" | "super_admin", from?: string | null): string {
  if (from && from !== "/login") return from;
  return role === "super_admin" ? "/super-admin" : "/admin/fafo";
}

export function LoginPage() {
  const { admin, login, loading } = useAdminSession();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const formId = useId();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; password?: string }>({});
  const [err, setErr] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  if (!loading && admin) {
    return <Navigate to={postLoginPath(admin.role, from)} replace />;
  }

  function validate(): boolean {
    const next: { phone?: string; password?: string } = {};
    const p = phone.trim();
    if (!p) next.phone = "Phone number is required.";
    if (!password) next.password = "Password is required.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await login(phone.trim(), password, remember);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-shell__aurora" aria-hidden />
      <div className="login-shell__grid" aria-hidden />

      <div className="login-card-wrap">
        <div className="login-brand">
          <span className="login-brand__mark" aria-hidden />
          <div>
            <div className="login-brand__title">FaFo Admin</div>
            <div className="login-brand__sub">Control center for the FaFo ecosystem</div>
          </div>
        </div>

        <div className="login-card">
          {loading ? (
            <div className="login-session-banner" role="status" aria-live="polite">
              <span className="login-session-banner__dot" aria-hidden />
              Checking session…
            </div>
          ) : null}
          <h1 className="login-card__headline">Sign in</h1>
          <p className="login-card__lead">Use the credentials issued to your team. Sessions stay on this device only.</p>

          <form className="login-form" onSubmit={(e) => void onSubmit(e)} noValidate>
            <label className="login-field" htmlFor={`${formId}-phone`}>
              <span>Phone</span>
              <input
                id={`${formId}-phone`}
                className={`input login-input${fieldErrors.phone ? " input--invalid" : ""}`}
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (fieldErrors.phone) setFieldErrors((x) => ({ ...x, phone: undefined }));
                }}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={fieldErrors.phone ? `${formId}-phone-err` : undefined}
              />
              {fieldErrors.phone ? (
                <span id={`${formId}-phone-err`} className="login-field__error">
                  {fieldErrors.phone}
                </span>
              ) : null}
            </label>

            <label className="login-field" htmlFor={`${formId}-password`}>
              <span>Password</span>
              <div className="login-password-wrap">
                <input
                  id={`${formId}-password`}
                  className={`input login-input${fieldErrors.password ? " input--invalid" : ""}`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((x) => ({ ...x, password: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? `${formId}-pw-err` : undefined}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {fieldErrors.password ? (
                <span id={`${formId}-pw-err`} className="login-field__error">
                  {fieldErrors.password}
                </span>
              ) : null}
            </label>

            <div className="login-row">
              <label className="login-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember me on this device</span>
              </label>
              <button type="button" className="login-link" onClick={() => setForgotOpen(true)}>
                Forgot password?
              </button>
            </div>

            {err ? <p className="error-text login-banner-error">{err}</p> : null}

            <Button type="submit" className="login-submit w-full" disabled={busy || loading}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="login-foot">© FaFo · Admin access is monitored. Unauthorized use is prohibited.</p>
      </div>

      {forgotOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby={`${formId}-forgot-title`}>
          <button type="button" className="modal-backdrop" aria-label="Close" onClick={() => setForgotOpen(false)} />
          <div className="modal-panel neon-card">
            <div className="modal-panel__head">
              <h2 id={`${formId}-forgot-title`} className="neon-card__title" style={{ margin: 0 }}>
                Reset access
              </h2>
              <button type="button" className="btn btn--ghost" onClick={() => setForgotOpen(false)}>
                Close
              </button>
            </div>
            <div className="modal-panel__body">
              <p className="muted" style={{ marginTop: 0 }}>
                Password resets are handled by your FaFo system owner. Contact them with your registered phone number so they can
                re-issue access.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
