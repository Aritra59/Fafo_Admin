import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AdminSessionProvider } from "./contexts/AdminSessionContext";
import { InstallPromptBanner } from "./components/InstallPromptBanner";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminLayout } from "./components/AdminLayout";
import { HomeRedirect } from "./components/HomeRedirect";
import { LoginPage } from "./pages/Login";
import { SuperAdminDashboard } from "./pages/SuperAdminDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import { SellersPage } from "./pages/SellersPage";
import { BuyersPage } from "./pages/BuyersPage";
import { OrdersPage } from "./pages/OrdersPage";
import { BillingPage } from "./pages/BillingPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { StoragePage } from "./pages/StoragePage";
import { AdsManagementPage } from "./pages/AdsManagementPage";
import { CategoriesLayout } from "./pages/categories/CategoriesLayout";
import { CategoryLinkingPage } from "./pages/categories/CategoryLinkingPage";
import { GlobalCuisineCategoriesPage } from "./pages/categories/GlobalCuisineCategoriesPage";
import { GlobalMenuCategoriesPage } from "./pages/categories/GlobalMenuCategoriesPage";
import { CreateSeller } from "./pages/CreateSeller";
import { CreateBuyer } from "./pages/CreateBuyer";
import { SellerDetail } from "./pages/SellerDetail";
import { BuyerDetail } from "./pages/BuyerDetail";

function LegacyCuisineCategoriesRedirect() {
  const { appName } = useParams();
  return <Navigate to={`/admin/${appName ?? "fafo"}/categories/cuisine`} replace />;
}

export default function App() {
  return (
    <AdminSessionProvider>
      <BrowserRouter>
        <>
          <InstallPromptBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/super-admin"
            element={
              <ProtectedRoute mode="super">
                <SuperAdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/:appName"
            element={
              <ProtectedRoute mode="admin">
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="sellers" element={<SellersPage />} />
            <Route path="create-seller" element={<CreateSeller />} />
            <Route path="seller/:sellerId" element={<SellerDetail />} />
            <Route path="buyers" element={<BuyersPage />} />
            <Route path="create-buyer" element={<CreateBuyer />} />
            <Route path="buyer/:buyerId" element={<BuyerDetail />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="ads" element={<AdsManagementPage />} />
            <Route path="cuisine-categories" element={<LegacyCuisineCategoriesRedirect />} />
            <Route path="categories" element={<CategoriesLayout />}>
              <Route index element={<Navigate to="cuisine" replace />} />
              <Route path="cuisine" element={<GlobalCuisineCategoriesPage />} />
              <Route path="menu" element={<GlobalMenuCategoriesPage />} />
              <Route path="linking" element={<CategoryLinkingPage />} />
            </Route>
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="storage" element={<StoragePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </>
      </BrowserRouter>
    </AdminSessionProvider>
  );
}
