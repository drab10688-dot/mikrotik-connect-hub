import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Auth/Login";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Diagnostics from "./pages/Diagnostics";
import Onus from "./pages/Onus";
import IspAcs from "./pages/IspAcs";
import Permissions from "./pages/Admin/Permissions";
import UsersAdmin from "./pages/Admin/Users";
import RegisterUser from "./pages/Admin/RegisterUser";
import TenantsAdmin from "./pages/Admin/Tenants";
import NotFound from "./pages/NotFound";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppErrorBoundary>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/isp/:slug" element={<LoginPage />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />

          {/* Panel de gestión de ONUs */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/onus" element={<ProtectedRoute permission="can_manage_onu"><Onus /></ProtectedRoute>} /></ProtectedRoute>} />
          <Route path="/acs" element={<ProtectedRoute><IspAcs /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute permission="can_manage_settings"><Settings /></ProtectedRoute>} />
          <Route path="/diagnostics" element={<ProtectedRoute permission="can_manage_diagnostics"><Diagnostics /></ProtectedRoute>} />

          {/* Administración multi-ISP */}
          <Route path="/admin/permissions" element={<ProtectedRoute requireAdmin><Permissions /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireSuperAdmin><UsersAdmin /></ProtectedRoute>} />
          <Route path="/admin/register-user" element={<ProtectedRoute requireSuperAdmin><RegisterUser /></ProtectedRoute>} /></ProtectedRoute>} /></ProtectedRoute>} />
          <Route path="/admin/tenants" element={<ProtectedRoute requireSuperAdmin><TenantsAdmin /></ProtectedRoute>} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </QueryClientProvider>
);

export default App;
