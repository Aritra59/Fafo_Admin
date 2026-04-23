import { Link } from "react-router-dom";
import { useAdminSession } from "../contexts/AdminSessionContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

const APPS = [
  { id: "fafo", name: "FaFo", blurb: "Food & fast orders" },
  { id: "grocer", name: "Grocer", blurb: "Grocery marketplace" },
  { id: "express", name: "Express", blurb: "Coming soon" },
] as const;

export function SuperAdminDashboard() {
  const { logout, admin } = useAdminSession();

  return (
    <div className="shell shell--super">
      <header className="super-bar">
        <div>
          <div className="brand-title">FaFo · Super Admin</div>
          <div className="muted small">{admin?.phone}</div>
        </div>
        <div className="super-bar__actions">
          <Link to="/admin/fafo" className="text-link">
            Open FaFo panel
          </Link>
          <Button variant="ghost" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <header className="page-head">
        <div>
          <h1 className="page-title">Apps</h1>
          <p className="muted">Choose an app workspace</p>
        </div>
      </header>
      <div className="grid-apps">
        {APPS.map((app) => (
          <Link key={app.id} to={`/admin/${app.id}`} className="app-tile-link">
            <Card title={app.name}>
              <p className="muted">{app.blurb}</p>
              <span className="app-tile-cta">Open panel →</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
