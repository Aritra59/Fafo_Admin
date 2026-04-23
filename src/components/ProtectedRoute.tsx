import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAdminSession } from "../contexts/AdminSessionContext";

type Mode = "super" | "admin";

export function ProtectedRoute({
  children,
  mode,
}: {
  children: ReactNode;
  mode: Mode;
}) {
  const { admin, loading } = useAdminSession();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="shell shell--center">
        <p className="muted">Loading session…</p>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  if (mode === "super" && admin.role !== "super_admin") {
    return <Navigate to="/admin/fafo" replace />;
  }

  if (mode === "admin" && admin.role !== "admin" && admin.role !== "super_admin") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
