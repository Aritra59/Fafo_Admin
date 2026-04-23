import { Navigate } from "react-router-dom";
import { useAdminSession } from "../contexts/AdminSessionContext";

export function HomeRedirect() {
  const { admin, loading } = useAdminSession();

  if (loading) {
    return (
      <div className="shell shell--center">
        <p className="muted">Loading session…</p>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  if (admin.role === "super_admin") {
    return <Navigate to="/super-admin" replace />;
  }

  return <Navigate to="/admin/fafo" replace />;
}
