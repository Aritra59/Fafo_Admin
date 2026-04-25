import { NavLink, Outlet, useParams } from "react-router-dom";

export function CategoriesLayout() {
  const { appName } = useParams();
  const root = `/admin/${appName ?? "fafo"}/categories`;

  return (
    <div className="page category-shell">
      <header className="page-head">
        <div>
          <p className="page-kicker muted">Admin</p>
          <h1 className="page-title">Categories</h1>
          <p className="muted small">Global cuisine and menu labels. Seller apps should listen to these collections in real time.</p>
        </div>
      </header>
      <nav className="category-shell__tabs" aria-label="Category sections">
        {(
          [
            ["cuisine", "Cuisine"],
            ["menu", "Menu categories"],
            ["linking", "Cuisine map"],
          ] as const
        ).map(([path, label]) => (
          <NavLink
            key={path}
            to={`${root}/${path}`}
            className={({ isActive }) => `category-tab${isActive ? " category-tab--on" : ""}`}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
