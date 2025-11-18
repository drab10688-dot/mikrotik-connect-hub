import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Auth/Login";
import SignupPage from "./pages/Auth/Signup";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Ppp from "./pages/Ppp";
import Vouchers from "./pages/Vouchers";
import Traffic from "./pages/Traffic";
import Settings from "./pages/Settings";
import Diagnostics from "./pages/Diagnostics";
import Profiles from "./pages/Profiles";
import Reports from "./pages/Reports";
import UsersAdmin from "./pages/Admin/Users";
import MikrotikDevices from "./pages/Admin/MikrotikDevices";
import AssignDevices from "./pages/Admin/AssignDevices";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
        <Route path="/ppp" element={<ProtectedRoute><Ppp /></ProtectedRoute>} />
        <Route path="/vouchers" element={<ProtectedRoute><Vouchers /></ProtectedRoute>} />
        <Route path="/profiles" element={<ProtectedRoute><Profiles /></ProtectedRoute>} />
        <Route path="/traffic" element={<ProtectedRoute><Traffic /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/diagnostics" element={<ProtectedRoute><Diagnostics /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute requireSuperAdmin><UsersAdmin /></ProtectedRoute>} />
        <Route path="/admin/mikrotik-devices" element={<ProtectedRoute requireSuperAdmin><MikrotikDevices /></ProtectedRoute>} />
        <Route path="/admin/assign-devices" element={<ProtectedRoute requireSuperAdmin><AssignDevices /></ProtectedRoute>} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
