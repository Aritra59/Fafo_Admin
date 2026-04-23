import { NavLink, Outlet, useParams } from "react-router-dom";
import { useAdminSession } from "../contexts/AdminSessionContext";
import { Button } from "./Button";

const links: { to: string; label: string; end?: boolean }[] = [
  { to: "", label: "Dashboard", end: true },
  { to: "sellers", label: "Sellers" },
  { to: "buyers", label: "Buyers" },
  { to: "orders", label: "Orders" },
  { to: "billing", label: "Billing / Slots" },
  { to: "analytics", label: "Analytics" },
  { to: "storage", label: "Storage" },
  { to: "templates", label: "Templates" },
  { to: "settings", label: "Settings" },
];

export function AdminLayout() {
  const { appName } = useParams();
  const { admin, logout } = useAdminSession();
  const base = `/admin/${appName ?? "fafo"}`;
  const showSuper = admin?.role === "super_admin";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="logo-dot" />
          <div>
            <div className="brand-title">FaFo Admin</div>
            <div className="brand-sub muted">{(appName ?? "").toUpperCase()}</div>
          </div>
        </div>
        <nav className="sidebar__nav">
          {links.map((l) => {
            const href = l.to ? `${base}/${l.to}` : base;
            return (
              <NavLink
                key={href}
                to={href}
                end={l.end}
                className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
              >
                {l.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          {showSuper ? (
            <NavLink to="/super-admin" className="nav-link nav-link--ghost">
              Super Admin
            </NavLink>
          ) : null}
          <div className="user-chip muted">{admin?.phone}</div>
          <Button variant="ghost" className="w-full" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
