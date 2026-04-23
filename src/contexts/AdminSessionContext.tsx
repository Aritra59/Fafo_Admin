import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import {
  clearAdminStorage,
  readAdminFromStorage,
  writeAdminToStorage,
  type AdminSession,
} from "../lib/adminSession";

type AdminSessionState = {
  admin: AdminSession | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
};

const AdminSessionContext = createContext<AdminSessionState | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAdmin(readAdminFromStorage());
    setLoading(false);
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const inputPhone = phone.trim();
    if (!inputPhone) throw new Error("Enter your phone number.");

    const q = query(collection(db, "admins"), where("phone", "==", inputPhone), limit(5));
    const snap = await getDocs(q);
    if (snap.empty) {
      throw new Error("No admin found for that phone number.");
    }

    const docSnap = snap.docs[0];
    const data = docSnap.data() as Record<string, unknown>;
    const storedPassword = typeof data.password === "string" ? data.password : "";
    if (storedPassword !== password) {
      throw new Error("Incorrect password.");
    }

    const role = data.role === "super_admin" || data.role === "admin" ? data.role : null;
    if (!role) {
      throw new Error("Admin record is missing a valid role.");
    }

    const session: AdminSession = {
      id: docSnap.id,
      phone: String(data.phone ?? inputPhone),
      role,
    };

    writeAdminToStorage(session);
    setAdmin(session);
  }, []);

  const logout = useCallback(() => {
    clearAdminStorage();
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({
      admin,
      loading,
      login,
      logout,
    }),
    [admin, loading, login, logout]
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionState {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession must be used within AdminSessionProvider");
  return ctx;
}
