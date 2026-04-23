export const ADMIN_STORAGE_KEY = "admin";

export type AdminRole = "admin" | "super_admin";

export type AdminSession = {
  id: string;
  phone: string;
  role: AdminRole;
};

export function parseAdminSession(raw: string | null): AdminSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const phone = typeof o.phone === "string" ? o.phone : "";
    const role = o.role === "super_admin" || o.role === "admin" ? o.role : null;
    if (!id || !phone || !role) return null;
    return { id, phone, role };
  } catch {
    return null;
  }
}

export function readAdminFromStorage(): AdminSession | null {
  return parseAdminSession(localStorage.getItem(ADMIN_STORAGE_KEY));
}

export function writeAdminToStorage(admin: AdminSession): void {
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admin));
}

export function clearAdminStorage(): void {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
}
