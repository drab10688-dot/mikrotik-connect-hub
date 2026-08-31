import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Auth/Login";
import ResetPassword from "./pages/Auth/ResetPassword";
import MailSettings from "./pages/Admin/MailSettings";
import Backups from "./pages/Admin/Backups";
import RemoteDesktop from "./pages/RemoteDesktop";
import RemoteDesktopMobile from "./pages/RemoteDesktopMobile";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import Isps from "./pages/Admin/Isps";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Diagnostics from "./pages/Diagnostics";
import Onus from "./pages/Onus";
import IspAcs from "./pages/IspAcs";
import Network from "./pages/Network";
import PppoeUsers from "./pages/PppoeUsers";
import OnuWeb from "./pages/OnuWeb";
import Topology from "./pages/Topology";
import Permissions from "./pages/Admin/Permissions";
import UsersAdmin from "./pages/Admin/Users";
import RegisterUser from "./pages/Admin/RegisterUser";

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
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/signup" element={<Navigate to="/login" replace />} />

          {/* Panel de gestión de ONUs */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/onus" element={<ProtectedRoute permission="can_manage_onu" module="onus" section="onus"><Onus /></ProtectedRoute>} />
          <Route path="/mikrotik" element={<ProtectedRoute permission="can_manage_pppoe" module="mikrotik" section="mikrotik"><Network /></ProtectedRoute>} />
          <Route path="/pppoe" element={<ProtectedRoute permission="can_manage_pppoe" module="mikrotik" section="pppoe"><PppoeUsers /></ProtectedRoute>} />
          <Route path="/onu-web" element={<ProtectedRoute module="onu_web" section="onu_web"><OnuWeb /></ProtectedRoute>} />
          <Route path="/topology" element={<ProtectedRoute module="mikrotik" section="topology"><Topology /></ProtectedRoute>} />
          <Route path="/acs" element={<ProtectedRoute section="vpn"><IspAcs /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute permission="can_manage_settings" section="configuracion"><Settings /></ProtectedRoute>} />
          <Route path="/diagnostics" element={<ProtectedRoute permission="can_manage_diagnostics" section="diagnostico"><Diagnostics /></ProtectedRoute>} />


          {/* Administración */}
          <Route path="/admin/permissions" element={<ProtectedRoute requireAdmin section="roles"><Permissions /></ProtectedRoute>} />
          <Route path="/admin/isps" element={<ProtectedRoute requireSuperAdmin><Isps /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute requireAdmin section="usuarios"><UsersAdmin /></ProtectedRoute>} />
          <Route path="/admin/register-user" element={<ProtectedRoute requireAdmin section="usuarios"><RegisterUser /></ProtectedRoute>} />
          <Route path="/admin/correo" element={<ProtectedRoute requireAdmin section="correo"><MailSettings /></ProtectedRoute>} />
          <Route path="/admin/respaldos" element={<ProtectedRoute requireAdmin section="respaldos"><Backups /></ProtectedRoute>} />
          

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="/vnc" element={<ProtectedRoute><RemoteDesktop /></ProtectedRoute>} />
          <Route path="/vnc-movil" element={<ProtectedRoute><RemoteDesktopMobile /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </QueryClientProvider>
);

export default App;
