import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hotspotApi, devicesApi } from "@/lib/api-client";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useHotspotActiveUsers, useHotspotUsers } from "@/hooks/useMikrotikData";
import { useVoucherInventory } from "@/hooks/useVoucherInventory";
import { useVoucherPresets } from "@/hooks/useVoucherPresets";
import { useAuth } from "@/hooks/useAuth";
import { useSecretaryPermissions } from "@/hooks/useSecretaryPermissions";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { ResellerManagement } from "@/components/vouchers/ResellerManagement";
import { VoucherQRDialog } from "@/components/vouchers/VoucherQRDialog";
import { type PrintVoucher, type PrintConfig } from "./HmonPrint";
import {
  Plus, Trash2, Wifi, Search, UserPlus, Key, RefreshCw, Printer, FileText,
  DollarSign, ShoppingCart, PiggyBank, CalendarIcon, FileDown, FileSpreadsheet,
  Upload, QrCode, Palette, Users, LayoutDashboard, Ticket, BarChart3, Settings2, Edit
} from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, eachMonthOfInterval, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import jsPDF from "jspdf";
import QRCode from "qrcode";

function generatePin(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// ─── Ticket Design Types ─────────────────────────────
type TicketDesign = "classic" | "modern" | "minimal" | "neon";

const TICKET_DESIGNS: { id: TicketDesign; label: string; desc: string }[] = [
  { id: "classic", label: "Clásico", desc: "Diseño tradicional con bordes punteados" },
  { id: "modern", label: "Moderno", desc: "Diseño limpio con gradientes" },
  { id: "minimal", label: "Minimalista", desc: "Solo información esencial" },
  { id: "neon", label: "Neon", desc: "Colores vibrantes estilo gaming" },
];

// ─── Print with designs ──────────────────────────────
async function printTicketDesign(voucher: PrintVoucher, config: PrintConfig, design: TicketDesign, includeQR: boolean) {
  let qrDataUrl = "";
  if (includeQR) {
    const canvas = document.createElement("canvas");
    const url = `${config.hotspotUrl}${config.hotspotUrl.includes("?") ? "&" : "?"}username=${voucher.code}&password=${voucher.password}`;
    await QRCode.toCanvas(canvas, url, { width: 200, errorCorrectionLevel: "H" });
    qrDataUrl = canvas.toDataURL();
  }

  const styles: Record<TicketDesign, string> = {
    classic: `body{font-family:'Courier New',monospace;width:80mm;padding:8mm 6mm;background:#fff}
      .ticket{text-align:center;border:2px dashed #333;padding:4mm;border-radius:3mm}
      .biz{font-size:16px;font-weight:bold;margin-bottom:3mm}
      .title{font-size:13px;font-weight:bold;border-top:2px dashed #000;border-bottom:2px dashed #000;padding:2mm 0;margin:3mm 0}
      .qr img{width:40mm;height:40mm;margin:3mm auto}
      .cred-item{margin:2mm 0;padding:2mm 3mm;background:#f3f3f3;border-radius:2mm;text-align:left}
      .lbl{font-weight:bold;font-size:9px;text-transform:uppercase;color:#555}.val{font-size:13px;font-weight:bold}
      .footer{font-size:7px;color:#888;margin-top:3mm;border-top:1px dashed #ccc;padding-top:2mm}`,

    modern: `body{font-family:Arial,sans-serif;width:80mm;padding:8mm 6mm;background:#fff}
      .ticket{text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:5mm;border-radius:4mm}
      .biz{font-size:16px;font-weight:bold;margin-bottom:2mm}
      .title{font-size:12px;opacity:0.9;margin:2mm 0 4mm}
      .qr{background:#fff;padding:3mm;border-radius:3mm;display:inline-block;margin:3mm auto}
      .qr img{width:38mm;height:38mm}
      .cred{background:rgba(255,255,255,0.15);border-radius:3mm;padding:3mm;margin:3mm 0}
      .cred-item{margin:1.5mm 0;text-align:left;padding:1mm 2mm}
      .lbl{font-size:8px;opacity:0.8;text-transform:uppercase}.val{font-size:12px;font-weight:bold}
      .footer{font-size:7px;opacity:0.6;margin-top:3mm}`,

    minimal: `body{font-family:system-ui,sans-serif;width:80mm;padding:8mm 6mm;background:#fff}
      .ticket{text-align:center}
      .biz{font-size:14px;font-weight:600;margin-bottom:2mm;color:#111}
      .title{display:none}
      .qr img{width:35mm;height:35mm;margin:3mm auto}
      .cred-item{margin:1mm 0;text-align:center}
      .lbl{font-size:8px;color:#999;text-transform:uppercase;letter-spacing:1px}.val{font-size:14px;font-weight:700;color:#111}
      .footer{font-size:7px;color:#ccc;margin-top:4mm}`,

    neon: `body{font-family:'Segoe UI',sans-serif;width:80mm;padding:8mm 6mm;background:#0a0a0a}
      .ticket{text-align:center;border:2px solid #0ff;padding:4mm;border-radius:4mm;box-shadow:0 0 15px rgba(0,255,255,0.3)}
      .biz{font-size:16px;font-weight:bold;color:#0ff;margin-bottom:3mm;text-shadow:0 0 10px rgba(0,255,255,0.5)}
      .title{font-size:12px;color:#f0f;margin:2mm 0 4mm;text-shadow:0 0 10px rgba(255,0,255,0.5)}
      .qr{background:#111;padding:3mm;border-radius:3mm;border:1px solid #333;display:inline-block;margin:3mm auto}
      .qr img{width:38mm;height:38mm}
      .cred-item{margin:2mm 0;padding:2mm 3mm;background:#111;border:1px solid #333;border-radius:2mm;text-align:left}
      .lbl{font-size:8px;color:#0ff;text-transform:uppercase}.val{font-size:12px;font-weight:bold;color:#fff}
      .footer{font-size:7px;color:#555;margin-top:3mm}`
  };

  const w = window.open("", "_blank");
  if (!w) return;

  w.document.write(`<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
${styles[design]}
.logo{max-width:45mm;max-height:16mm;margin:0 auto 2mm}
@media print{@page{margin:0;size:80mm auto}}
</style></head><body><div class="ticket">
${config.logo ? `<img src="${config.logo}" class="logo"/>` : ""}
<div class="biz">${config.businessName}</div>
<div class="title">🌐 WiFi Voucher</div>
${includeQR && qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}"/></div>` : ""}
<div class="cred">
<div class="cred-item"><div class="lbl">Usuario</div><div class="val">${voucher.code}</div></div>
<div class="cred-item"><div class="lbl">Contraseña</div><div class="val">${voucher.password}</div></div>
<div class="cred-item"><div class="lbl">Plan</div><div class="val">${voucher.profile}</div></div>
${voucher.validity ? `<div class="cred-item"><div class="lbl">Duración</div><div class="val">${voucher.validity}</div></div>` : ""}
${voucher.price ? `<div class="cred-item"><div class="lbl">Precio</div><div class="val">$${voucher.price.toFixed(2)}</div></div>` : ""}
</div>
<div class="footer">Escanea el QR para conectarte • ${config.businessName}</div>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),400);window.onafterprint=()=>window.close();</script>
</body></html>`);
  w.document.close();
}

async function printCardsDesign(vouchers: PrintVoucher[], config: PrintConfig, design: TicketDesign, includeQR: boolean) {
  const qrImages: string[] = [];
  if (includeQR) {
    for (const v of vouchers) {
      const canvas = document.createElement("canvas");
      const url = `${config.hotspotUrl}${config.hotspotUrl.includes("?") ? "&" : "?"}username=${v.code}&password=${v.password}`;
      await QRCode.toCanvas(canvas, url, { width: 180, errorCorrectionLevel: "H" });
      qrImages.push(canvas.toDataURL());
    }
  }

  const cardColors: Record<TicketDesign, { bg: string; border: string; text: string }> = {
    classic: { bg: "#fff", border: "#333", text: "#000" },
    modern: { bg: "linear-gradient(135deg,#667eea,#764ba2)", border: "transparent", text: "#fff" },
    minimal: { bg: "#fff", border: "#e5e5e5", text: "#111" },
    neon: { bg: "#0a0a0a", border: "#0ff", text: "#fff" },
  };
  const c = cardColors[design];

  const cards = vouchers.map((v, i) => `
<div class="card" style="background:${c.bg};border:1.5px solid ${c.border};color:${c.text}">
  <div class="card-header">${config.businessName}</div>
  ${includeQR && qrImages[i] ? `<div class="card-qr"><img src="${qrImages[i]}"/></div>` : ""}
  <div class="card-info">
    <div class="card-row"><span class="card-lbl">USR:</span><span class="card-val">${v.code}</span></div>
    <div class="card-row"><span class="card-lbl">PWD:</span><span class="card-val">${v.password}</span></div>
    <div class="card-row"><span class="card-lbl">Plan:</span><span class="card-val">${v.profile}</span></div>
    ${v.validity ? `<div class="card-row"><span class="card-lbl">Dur:</span><span class="card-val">${v.validity}</span></div>` : ""}
    ${v.price ? `<div class="card-row"><span class="card-lbl">$</span><span class="card-val">${v.price.toFixed(2)}</span></div>` : ""}
  </div>
</div>`).join("");

  const w = window.open("", "_blank");
  if (!w) return;

  w.document.write(`<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;padding:8mm;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}
.card{border-radius:3mm;padding:4mm;page-break-inside:avoid;text-align:center}
.card-header{font-size:11px;font-weight:bold;margin-bottom:2mm;padding-bottom:2mm;border-bottom:1px dashed rgba(128,128,128,0.4)}
.card-qr img{width:32mm;height:32mm;margin:2mm auto}
.card-info{text-align:left;font-size:9px;line-height:1.6}
.card-row{display:flex;gap:1mm}
.card-lbl{font-weight:bold;opacity:0.7;min-width:28px}
.card-val{font-family:monospace;font-weight:bold}
@media print{@page{margin:8mm;size:A4}}
</style></head><body>
<div class="grid">${cards}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),500);window.onafterprint=()=>window.close();</script>
</body></html>`);
  w.document.close();
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════
export function HmonUsers() {
  const deviceId = getSelectedDeviceId() || "";
  const [mainTab, setMainTab] = useState("usuarios");
  const [userSubTab, setUserSubTab] = useState("active");
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [authMode, setAuthMode] = useState<"pin" | "userpass">("pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("default");
  const [comment, setComment] = useState("");
  const [pinCount, setPinCount] = useState(1);
  const [showBatchPin, setShowBatchPin] = useState(false);

  // Voucher states
  const [voucherCount, setVoucherCount] = useState(1);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [validity, setValidity] = useState("24h");
  const [price, setPrice] = useState(0);
  const [selectedVouchers, setSelectedVouchers] = useState<string[]>([]);
  const [qrDialogVoucher, setQrDialogVoucher] = useState<any>(null);

  // Preset management
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [editPreset, setEditPreset] = useState<any>(null);
  const [presetName, setPresetName] = useState("");
  const [presetValidity, setPresetValidity] = useState("1h");
  const [presetPrice, setPresetPrice] = useState(0);
  const [presetDesc, setPresetDesc] = useState("");

  // Print config
  const [businessName, setBusinessName] = useState(() => localStorage.getItem("hmon_business_name") || "WiFi Service");
  const [logo, setLogo] = useState(() => localStorage.getItem("hmon_logo") || "");
  const [ticketDesign, setTicketDesign] = useState<TicketDesign>(() => (localStorage.getItem("hmon_ticket_design") as TicketDesign) || "classic");
  const [includeQR, setIncludeQR] = useState(() => localStorage.getItem("hmon_include_qr") !== "false");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Accounting states
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));

  const { isAdmin, isSuperAdmin, isSecretary } = useAuth();
  const { assignments: secretaryAssignments } = useSecretaryPermissions();
  const qc = useQueryClient();

  // Get hotspot sub-permissions for secretary
  const currentPerms = secretaryAssignments?.find((a: any) => a.mikrotik_id === deviceId);
  const canCreateUsers = !isSecretary || currentPerms?.can_create_hotspot_users !== false;
  const canEditUsers = !isSecretary || currentPerms?.can_edit_hotspot_users !== false;
  const canDeleteUsers = !isSecretary || currentPerms?.can_delete_hotspot_users !== false;
  const canManageVouchersP = !isSecretary || currentPerms?.can_manage_vouchers !== false;
  const canSellVouchersP = !isSecretary || currentPerms?.can_sell_vouchers !== false;
  const canPrintVouchersP = !isSecretary || currentPerms?.can_print_vouchers !== false;
  const canViewAccounting = !isSecretary || currentPerms?.can_view_hotspot_accounting !== false;
  const canViewReports = !isSecretary || currentPerms?.can_view_hotspot_reports !== false;

  // Data queries
  const { data: activeData } = useHotspotActiveUsers();
  const { data: usersData } = useHotspotUsers();
  const active = Array.isArray(activeData) ? activeData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const { data: profiles = [] } = useQuery({
    queryKey: ["hmon-profiles", deviceId],
    queryFn: async () => { if (!deviceId) return []; return await hotspotApi.profiles(deviceId); },
    enabled: !!deviceId,
  });

  const { data: deviceInfo } = useQuery({
    queryKey: ["device-info", deviceId],
    queryFn: async () => { if (!deviceId) return null; const devices = await devicesApi.list(); return devices.find((d: any) => d.id === deviceId); },
    enabled: !!deviceId,
  });

  const hotspotUrl = deviceInfo?.hotspot_url || "http://192.168.88.1/login";
  const { presets, createPreset, isCreating: isCreatingPreset, updatePreset, deletePreset } = useVoucherPresets(deviceId);
  const { vouchers, isLoading: vouchersLoading, stats, generateVouchers, isGenerating, deleteVoucher, syncVouchers, isSyncing } = useVoucherInventory(deviceId);

  const printConfig: PrintConfig = { businessName, logo: logo || undefined, hotspotUrl };

  // Accounting queries
  const dk = `${format(startDate, "yyyy-MM-dd")}_${format(endDate, "yyyy-MM-dd")}`;

  const { data: salesHistory = [] } = useQuery({
    queryKey: ["hmon-acc-sales", deviceId, dk],
    queryFn: async () => {
      if (!deviceId) return [];
      const { data, error } = await supabase.from("voucher_sales_history").select("*").eq("mikrotik_id", deviceId).gte("sold_at", format(startDate, "yyyy-MM-dd")).lte("sold_at", format(endDate, "yyyy-MM-dd")).order("sold_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!deviceId,
  });

  const { data: activeSold = [] } = useQuery({
    queryKey: ["hmon-acc-active", deviceId, dk],
    queryFn: async () => {
      if (!deviceId) return [];
      const { data, error } = await supabase.from("vouchers").select("*").eq("mikrotik_id", deviceId).eq("status", "sold").gte("sold_at", format(startDate, "yyyy-MM-dd")).lte("sold_at", format(endDate, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
    enabled: !!deviceId,
  });

  const { data: resellers = [] } = useQuery({
    queryKey: ["hmon-acc-resellers", deviceId],
    queryFn: async () => { if (!deviceId) return []; const { data } = await supabase.from("reseller_assignments").select("*").eq("mikrotik_id", deviceId); return data || []; },
    enabled: !!deviceId,
  });

  const { data: resellerProfiles = [] } = useQuery({
    queryKey: ["hmon-acc-reseller-profiles", resellers],
    queryFn: async () => { if (!resellers.length) return []; const ids = resellers.map((r: any) => r.reseller_id); const { data } = await supabase.from("profiles").select("*").in("user_id", ids); return data || []; },
    enabled: resellers.length > 0,
  });

  // Mutations
  const addUserMutation = useMutation({
    mutationFn: async (data: { name: string; password: string; profile: string; comment?: string }) => await hotspotApi.addUser(deviceId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotspot-users"] }); toast.success("Usuario creado"); setShowAdd(false); setUsername(""); setPassword(""); setComment(""); },
    onError: (e: any) => toast.error(e.message || "Error al crear usuario"),
  });

  const batchPinMutation = useMutation({
    mutationFn: async (count: number) => {
      const created: { name: string; password: string; profile: string }[] = [];
      for (let i = 0; i < count; i++) {
        const pin = generatePin(8); const pwd = generatePin(6);
        await hotspotApi.addUser(deviceId, { name: pin, password: pwd, profile: selectedProfile, comment: `PIN HMON ${new Date().toISOString().slice(0, 10)}` });
        created.push({ name: pin, password: pwd, profile: selectedProfile });
      }
      return created;
    },
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["hotspot-users"] }); toast.success(`${data.length} PINs creados`); setShowBatchPin(false); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => hotspotApi.removeUser(deviceId, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotspot-users"] }); qc.invalidateQueries({ queryKey: ["hotspot-active"] }); toast.success("Usuario eliminado"); setDeleteId(null); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const cleanExpiredMutation = useMutation({
    mutationFn: async () => {
      const now = new Date(); const toDelete: string[] = [];
      for (const u of users) {
        const c = u.comment || "";
        const m = c.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
        if (m) { try { const [_, ds, ts] = m; const [mo, dy, yr] = ds.split("/"); if (new Date(`${yr}-${mo}-${dy}T${ts}`) < now && u[".id"]) toDelete.push(u[".id"]); } catch {} }
      }
      for (const id of toDelete) await hotspotApi.removeUser(deviceId, id);
      return toDelete.length;
    },
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["hotspot-users"] }); qc.invalidateQueries({ queryKey: ["hotspot-active"] }); toast.success(`${c} expirados eliminados`); },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  // Handlers
  const handleAddUser = () => {
    if (authMode === "pin") {
      const pin = generatePin(8); const pwd = generatePin(6);
      addUserMutation.mutate({ name: pin, password: pwd, profile: selectedProfile, comment: comment || "PIN HMON" });
    } else {
      if (!username.trim() || !password.trim()) { toast.error("Ingresa usuario y contraseña"); return; }
      addUserMutation.mutate({ name: username.trim(), password: password.trim(), profile: selectedProfile, comment: comment || undefined });
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { toast.error("Logo debe ser menor a 500KB"); return; }
      const reader = new FileReader();
      reader.onloadend = () => { const b64 = reader.result as string; setLogo(b64); localStorage.setItem("hmon_logo", b64); };
      reader.readAsDataURL(file);
    }
  };

  const handleBusinessNameChange = (name: string) => { setBusinessName(name); localStorage.setItem("hmon_business_name", name); };
  const handleDesignChange = (d: TicketDesign) => { setTicketDesign(d); localStorage.setItem("hmon_ticket_design", d); };
  const handleToggleQR = (v: boolean) => { setIncludeQR(v); localStorage.setItem("hmon_include_qr", String(v)); };

  const handleGenerate = () => {
    if (!deviceId || !selectedPreset) { toast.error("Selecciona un plan"); return; }
    const preset = presets?.find(p => p.id === selectedPreset);
    if (!preset) { toast.error("Plan no encontrado"); return; }
    generateVouchers({ count: voucherCount, profile: preset.name, mikrotikId: deviceId, validity: preset.validity, price: preset.price });
  };

  // Preset handlers
  const handleSavePreset = () => {
    if (!presetName.trim()) { toast.error("Nombre requerido"); return; }
    if (editPreset) {
      updatePreset({ id: editPreset.id, name: presetName, validity: presetValidity, price: presetPrice, description: presetDesc, mikrotikId: deviceId });
    } else {
      createPreset({ name: presetName, validity: presetValidity, price: presetPrice, description: presetDesc, mikrotikId: deviceId });
    }
    setShowAddPreset(false); setEditPreset(null); setPresetName(""); setPresetValidity("1h"); setPresetPrice(0); setPresetDesc("");
  };

  const openEditPreset = (p: any) => {
    setEditPreset(p); setPresetName(p.name); setPresetValidity(p.validity); setPresetPrice(p.price); setPresetDesc(p.description || ""); setShowAddPreset(true);
  };

  // Print handlers
  const handlePrintSingle = (voucher: any) => {
    const pv: PrintVoucher = { code: voucher.code, password: voucher.password, profile: voucher.profile, validity: voucher.validity, price: voucher.price };
    printTicketDesign(pv, printConfig, ticketDesign, includeQR);
  };

  // Print hotspot user as ticket
  const handlePrintUser = (user: any) => {
    const pv: PrintVoucher = { code: user.name, password: user.password || "****", profile: user.profile || "default" };
    printTicketDesign(pv, printConfig, ticketDesign, includeQR);
  };

  const handleBatchPrintTickets = async () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    for (const v of vList) {
      await printTicketDesign({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }, printConfig, ticketDesign, includeQR);
    }
    setSelectedVouchers([]);
  };

  const handleBatchPrintA4 = () => {
    if (selectedVouchers.length === 0) { toast.error("Selecciona vouchers"); return; }
    const vList = vouchers?.filter(v => selectedVouchers.includes(v.id)) || [];
    const pvs: PrintVoucher[] = vList.map(v => ({ code: v.code, password: v.password, profile: v.profile, validity: v.validity, price: v.price }));
    printCardsDesign(pvs, printConfig, ticketDesign, includeQR);
    setSelectedVouchers([]);
  };

  // Accounting calculations
  const allSales = useMemo(() => [...salesHistory, ...activeSold], [salesHistory, activeSold]);
  const balance = useMemo(() => ({ totalIncome: allSales.reduce((s: number, v: any) => s + Number(v.price || 0), 0), count: allSales.length }), [allSales]);

  const monthlyData = useMemo(() => {
    return eachMonthOfInterval({ start: startDate, end: endDate }).map(date => {
      const mv = allSales.filter((v: any) => isSameMonth(new Date(v.sold_at), date));
      return { month: format(date, "MMM", { locale: es }), vouchers: mv.reduce((s: number, v: any) => s + Number(v.price || 0), 0), count: mv.length };
    });
  }, [allSales, startDate, endDate]);

  const profileBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    allSales.forEach((v: any) => {
      const p = v.profile || "default";
      if (!map[p]) map[p] = { count: 0, revenue: 0 };
      map[p].count++;
      map[p].revenue += Number(v.price || 0);
    });
    return Object.entries(map).map(([name, d]) => ({ name, ...d }));
  }, [allSales]);

  const resellerReport = useMemo(() => {
    return resellers.map((r: any) => {
      const sales = allSales.filter((v: any) => v.sold_by === r.reseller_id);
      const total = sales.reduce((s: number, v: any) => s + Number(v.price || 0), 0);
      const commission = total * (Number(r.commission_percentage) / 100);
      const profile = resellerProfiles.find((p: any) => p.user_id === r.reseller_id);
      return { id: r.id, name: profile?.full_name || profile?.email || "Sin nombre", email: profile?.email || "", salesCount: sales.length, totalSales: total, commissionRate: Number(r.commission_percentage), commission, netIncome: total - commission };
    });
  }, [resellers, allSales, resellerProfiles]);

  const movements = useMemo(() => {
    return allSales.map((v: any) => ({ date: v.sold_at, description: `Voucher ${v.voucher_code || v.code}`, amount: Number(v.price || 0), profile: v.profile || "-" }))
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  }, [allSales]);

  const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

  const exportCSV = () => {
    const lines = [`Contabilidad HMON - ${format(startDate, "dd/MM/yyyy")} a ${format(endDate, "dd/MM/yyyy")}`, "", `Total: $${balance.totalIncome.toLocaleString()}`, `Ventas: ${balance.count}`, "",
      ...(resellerReport.length > 0 ? ["--- Revendedores ---", "Nombre,Ventas,Total,Comisión%,Comisión$,Neto", ...resellerReport.map(r => `${r.name},${r.salesCount},$${r.totalSales.toFixed(2)},${r.commissionRate}%,$${r.commission.toFixed(2)},$${r.netIncome.toFixed(2)}`), ""] : []),
      "--- Ventas ---", "Fecha,Voucher,Perfil,Monto", ...movements.map(m => `${format(new Date(m.date), "dd/MM/yyyy HH:mm")},${m.description},${m.profile},${m.amount.toFixed(2)}`)];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `hmon_contabilidad_${format(startDate, "yyyy-MM-dd")}.csv`; a.click();
    toast.success("CSV exportado");
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFontSize(16); doc.text("Contabilidad Hotspot", pw / 2, 20, { align: "center" });
    doc.setFontSize(10); doc.text(`${format(startDate, "dd/MM/yyyy")} - ${format(endDate, "dd/MM/yyyy")}`, pw / 2, 28, { align: "center" });
    let y = 42;
    doc.setFontSize(12); doc.text("Resumen", 20, y); y += 8;
    doc.setFontSize(10); doc.text(`Total Ingresos: $${balance.totalIncome.toLocaleString()}`, 20, y); y += 7;
    doc.text(`Vouchers Vendidos: ${balance.count}`, 20, y); y += 12;
    if (profileBreakdown.length > 0) {
      doc.setFontSize(12); doc.text("Por Plan", 20, y); y += 8; doc.setFontSize(9);
      profileBreakdown.forEach(p => { doc.text(`${p.name}: ${p.count} ventas - $${p.revenue.toFixed(0)}`, 25, y); y += 6; });
      y += 6;
    }
    if (resellerReport.length > 0) {
      doc.setFontSize(12); doc.text("Revendedores", 20, y); y += 8; doc.setFontSize(9);
      resellerReport.forEach(r => { if (y > 270) { doc.addPage(); y = 20; } doc.text(`${r.name}: ${r.salesCount} ventas, $${r.totalSales.toFixed(0)} | Com: $${r.commission.toFixed(0)} (${r.commissionRate}%) | Neto: $${r.netIncome.toFixed(0)}`, 20, y); y += 6; });
    }
    doc.setFontSize(7); doc.text(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")} | HMON by Omnisync`, pw / 2, 285, { align: "center" });
    doc.save(`hmon_contabilidad_${format(startDate, "yyyy-MM-dd")}.pdf`);
    toast.success("PDF exportado");
  };

  const fActive = active.filter((u: any) => !search || (u.user || u.name || "").toLowerCase().includes(search.toLowerCase()) || (u.address || "").includes(search));
  const fUsers = users.filter((u: any) => !search || (u.name || "").toLowerCase().includes(search.toLowerCase()) || (u.comment || "").toLowerCase().includes(search.toLowerCase()));

  if (!deviceId) return <div className="text-center py-12 text-muted-foreground text-sm">No hay dispositivo conectado</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2"><Wifi className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Gestión Hotspot</h2></div>
      </div>

      {/* Main Tabs */}
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="h-9 flex-wrap">
          <TabsTrigger value="usuarios" className="text-xs gap-1"><Wifi className="h-3 w-3" />Usuarios</TabsTrigger>
          <TabsTrigger value="planes" className="text-xs gap-1"><Settings2 className="h-3 w-3" />Planes</TabsTrigger>
          {canManageVouchersP && <TabsTrigger value="vouchers" className="text-xs gap-1"><Ticket className="h-3 w-3" />Vouchers</TabsTrigger>}
          {canPrintVouchersP && <TabsTrigger value="imprimir" className="text-xs gap-1"><Printer className="h-3 w-3" />Imprimir</TabsTrigger>}
          {canViewAccounting && <TabsTrigger value="contabilidad" className="text-xs gap-1"><PiggyBank className="h-3 w-3" />Contabilidad</TabsTrigger>}
          {canViewReports && <TabsTrigger value="reportes" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Reportes</TabsTrigger>}
        </TabsList>

        {/* ═══ USUARIOS TAB ═══ */}
        <TabsContent value="usuarios" className="mt-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="relative md:w-64"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" /></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => cleanExpiredMutation.mutate()} disabled={cleanExpiredMutation.isPending}><RefreshCw className={`h-3.5 w-3.5 mr-1 ${cleanExpiredMutation.isPending ? "animate-spin" : ""}`} />Limpiar</Button>
              {canCreateUsers && <Button size="sm" variant="outline" onClick={() => setShowBatchPin(true)}><Key className="h-3.5 w-3.5 mr-1" />PINs</Button>}
              {canCreateUsers && <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-3.5 w-3.5 mr-1" />Agregar</Button>}
            </div>
          </div>

          <Tabs value={userSubTab} onValueChange={setUserSubTab}>
            <TabsList className="h-8"><TabsTrigger value="active" className="text-xs">Activos ({active.length})</TabsTrigger><TabsTrigger value="users" className="text-xs">Todos ({users.length})</TabsTrigger></TabsList>

            <TabsContent value="active" className="mt-2">
              <Card><CardContent className="p-0"><div className="overflow-x-auto">
                <Table><TableHeader><TableRow>
                  <TableHead className="text-[10px]">Usuario</TableHead><TableHead className="text-[10px]">IP</TableHead>
                  <TableHead className="text-[10px]">MAC</TableHead><TableHead className="text-[10px]">Perfil</TableHead><TableHead className="text-[10px]">Uptime</TableHead>
                </TableRow></TableHeader><TableBody>
                  {fActive.length > 0 ? fActive.map((u: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{u.user || u.name || "-"}</TableCell>
                      <TableCell className="text-[10px] font-mono">{u.address || "-"}</TableCell>
                      <TableCell className="text-[10px] font-mono text-muted-foreground">{u["mac-address"] || "-"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{u.uptime || "0s"}</TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios activos</TableCell></TableRow>}
                </TableBody></Table>
              </div></CardContent></Card>
            </TabsContent>

            <TabsContent value="users" className="mt-2">
              <Card><CardContent className="p-0"><div className="overflow-x-auto">
                <Table><TableHeader><TableRow>
                  <TableHead className="text-[10px]">Nombre</TableHead><TableHead className="text-[10px]">Perfil</TableHead>
                  <TableHead className="text-[10px]">Comentario</TableHead><TableHead className="text-[10px]">Estado</TableHead><TableHead className="text-[10px] text-right">Acciones</TableHead>
                </TableRow></TableHeader><TableBody>
                  {fUsers.length > 0 ? fUsers.map((u: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium font-mono">{u.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{u.comment || "-"}</TableCell>
                      <TableCell><Badge variant={u.disabled === "true" ? "destructive" : "default"} className="text-[9px]">{u.disabled === "true" ? "Deshabilitado" : "Activo"}</Badge></TableCell>
                      <TableCell className="text-right">
                         <div className="flex gap-0.5 justify-end">
                          {canPrintVouchersP && <Button variant="ghost" size="sm" onClick={() => handlePrintUser(u)} title="Imprimir"><Printer className="h-3.5 w-3.5" /></Button>}
                          {canDeleteUsers && <Button variant="ghost" size="sm" onClick={() => setDeleteId(u[".id"])}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                         </div>
                      </TableCell>
                    </TableRow>
                  )) : <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios</TableCell></TableRow>}
                </TableBody></Table>
              </div></CardContent></Card>
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ═══ PLANES TAB (Preset Management) ═══ */}
        <TabsContent value="planes" className="mt-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold flex items-center gap-1"><Settings2 className="h-4 w-4 text-primary" />Configurar Planes / Presets</h3>
            <Button size="sm" onClick={() => { setEditPreset(null); setPresetName(""); setPresetValidity("1h"); setPresetPrice(0); setPresetDesc(""); setShowAddPreset(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Nuevo Plan
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">Configura los planes antes de generar vouchers o PINs. Cada plan define duración, precio y se sincroniza como perfil en MikroTik.</p>

          {(presets?.length || 0) > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {presets?.map(p => (
                <Card key={p.id} className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm">{p.name}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.description || "Sin descripción"}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEditPreset(p)}><Edit className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`¿Eliminar ${p.name}?`)) deletePreset(p.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">Duración</p>
                        <p className="font-bold text-sm">{p.validity}</p>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">Precio</p>
                        <p className="font-bold text-sm text-primary">${p.price.toFixed(2)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Settings2 className="h-12 w-12 mb-3 opacity-50" />
              <p className="font-medium">No hay planes configurados</p>
              <p className="text-xs mt-1">Crea un plan antes de generar vouchers</p>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* ═══ VOUCHERS TAB ═══ */}
        <TabsContent value="vouchers" className="mt-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold flex items-center gap-1"><Ticket className="h-4 w-4 text-primary" />Inventario de Vouchers</h3>
            <div className="flex flex-wrap gap-2">
              {selectedVouchers.length > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={handleBatchPrintTickets}><Printer className="h-3.5 w-3.5 mr-1" />80mm ({selectedVouchers.length})</Button>
                  <Button size="sm" variant="outline" onClick={handleBatchPrintA4}><FileText className="h-3.5 w-3.5 mr-1" />A4 ({selectedVouchers.length})</Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => { if (deviceId) syncVouchers(deviceId); }} disabled={isSyncing}><RefreshCw className={`h-3.5 w-3.5 mr-1 ${isSyncing ? "animate-spin" : ""}`} />Sync</Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card className="border-l-4 border-l-primary"><CardContent className="p-2"><p className="text-[10px] text-muted-foreground">Disponibles</p><p className="text-lg font-bold">{stats?.available || 0}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-2))]"><CardContent className="p-2"><p className="text-[10px] text-muted-foreground">Vendidos</p><p className="text-lg font-bold">{stats?.sold || 0}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-3))]"><CardContent className="p-2"><p className="text-[10px] text-muted-foreground">En Uso</p><p className="text-lg font-bold">{stats?.used || 0}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-4))]"><CardContent className="p-2"><p className="text-[10px] text-muted-foreground">Total</p><p className="text-lg font-bold">{vouchers?.length || 0}</p></CardContent></Card>
          </div>

          {/* Generate */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Generar Vouchers</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(presets?.length || 0) === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground mb-2">Primero configura los planes en la pestaña "Planes"</p>
                  <Button size="sm" variant="outline" onClick={() => setMainTab("planes")}><Settings2 className="h-3.5 w-3.5 mr-1" />Ir a Planes</Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} max={100} value={voucherCount} onChange={(e) => setVoucherCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
                    <div className="space-y-1">
                      <Label className="text-xs">Plan</Label>
                      <Select value={selectedPreset} onValueChange={(v) => { setSelectedPreset(v); const p = presets?.find(x => x.id === v); if (p) { setValidity(p.validity); setPrice(p.price); } }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar plan" /></SelectTrigger>
                        <SelectContent>{presets?.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} - {p.validity} - ${p.price.toFixed(2)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label className="text-xs">Precio</Label><Input type="number" value={price} readOnly className="h-8 text-xs bg-muted/30" /></div>
                  </div>
                  <Button size="sm" onClick={handleGenerate} disabled={isGenerating || !selectedPreset} className="w-full"><Plus className="h-3.5 w-3.5 mr-1" />{isGenerating ? "Generando..." : `Generar ${voucherCount} Voucher(s)`}</Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Voucher Table */}
          <Card><CardContent className="pt-4">
            {vouchersLoading ? <div className="text-center py-6 text-xs text-muted-foreground">Cargando...</div> : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-8"><Checkbox checked={selectedVouchers.length === (vouchers?.length || 0) && (vouchers?.length || 0) > 0} onCheckedChange={(c) => setSelectedVouchers(c ? vouchers?.map(v => v.id) || [] : [])} /></TableHead>
                    <TableHead className="text-[10px]">Código</TableHead><TableHead className="text-[10px]">Contraseña</TableHead>
                    <TableHead className="text-[10px]">Plan</TableHead><TableHead className="text-[10px]">Estado</TableHead>
                    <TableHead className="text-[10px]">Precio</TableHead><TableHead className="text-[10px] text-right">Acciones</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(vouchers || []).length > 0 ? (vouchers || []).map((v: any) => (
                      <TableRow key={v.id}>
                        <TableCell><Checkbox checked={selectedVouchers.includes(v.id)} onCheckedChange={() => setSelectedVouchers(prev => prev.includes(v.id) ? prev.filter(x => x !== v.id) : [...prev, v.id])} /></TableCell>
                        <TableCell className="text-xs font-mono font-bold">{v.code}</TableCell>
                        <TableCell className="text-xs font-mono">{v.password}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px]">{v.profile}</Badge></TableCell>
                        <TableCell><Badge variant={v.status === "available" ? "default" : v.status === "expired" ? "destructive" : "secondary"} className="text-[9px]">{v.status === "available" ? "Disponible" : v.status === "sold" ? "Vendido" : v.status === "used" ? "En Uso" : "Expirado"}</Badge></TableCell>
                        <TableCell className="text-xs">{v.price ? `$${v.price.toFixed(2)}` : "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setQrDialogVoucher(v)}><QrCode className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => handlePrintSingle(v)}><Printer className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="sm" onClick={() => { if (confirm(`¿Eliminar ${v.code}?`)) deleteVoucher(v.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )) : <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">Sin vouchers</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent></Card>

          {(isAdmin || isSuperAdmin) && <ResellerManagement mikrotikId={deviceId} />}
        </TabsContent>

        {/* ═══ IMPRIMIR TAB (Customizable) ═══ */}
        <TabsContent value="imprimir" className="mt-3 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Palette className="h-4 w-4" />Personalizar Etiquetas</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Nombre del Negocio</Label>
                  <Input value={businessName} onChange={(e) => handleBusinessNameChange(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Logo</Label>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="w-full h-8 text-xs">
                    <Upload className="h-3.5 w-3.5 mr-1" />{logo ? "Cambiar Logo" : "Subir Logo"}
                  </Button>
                  {logo && <div className="mt-1 flex justify-center"><img src={logo} alt="Logo" className="h-10 object-contain rounded" /></div>}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-2">
                  <Checkbox checked={includeQR} onCheckedChange={(c) => handleToggleQR(!!c)} />
                  Incluir código QR en las etiquetas
                </Label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Diseño de Etiqueta</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {TICKET_DESIGNS.map(d => (
                    <button key={d.id} onClick={() => handleDesignChange(d.id)}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${ticketDesign === d.id ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}>
                      <p className="text-xs font-bold">{d.label}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{d.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Vista Previa</Label>
                <div className={`border rounded-lg p-4 max-w-[300px] mx-auto text-center ${ticketDesign === "neon" ? "bg-[#0a0a0a] text-white border-cyan-500" : ticketDesign === "modern" ? "bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white" : "bg-card"}`}>
                  {logo && <img src={logo} alt="Logo" className="h-8 mx-auto mb-2 object-contain" />}
                  <p className={`font-bold text-sm ${ticketDesign === "neon" ? "text-cyan-400" : ""}`}>{businessName}</p>
                  {ticketDesign !== "minimal" && <p className="text-[10px] opacity-70 my-1">🌐 WiFi Voucher</p>}
                  {includeQR && <div className="my-2 inline-block bg-white p-2 rounded"><QrCode className="h-12 w-12 text-black" /></div>}
                  <div className={`text-left text-xs space-y-1 mt-2 ${ticketDesign === "neon" ? "bg-[#111] p-2 rounded border border-[#333]" : ticketDesign === "modern" ? "bg-white/15 p-2 rounded" : "bg-muted/50 p-2 rounded"}`}>
                    <p><span className="opacity-60 text-[10px]">USR:</span> <span className="font-bold font-mono">ABC12345</span></p>
                    <p><span className="opacity-60 text-[10px]">PWD:</span> <span className="font-bold font-mono">XY67ZW</span></p>
                    <p><span className="opacity-60 text-[10px]">Plan:</span> <span className="font-bold">1h-5Mbps</span></p>
                    <p><span className="opacity-60 text-[10px]">Precio:</span> <span className="font-bold">$5.00</span></p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ CONTABILIDAD TAB ═══ */}
        <TabsContent value="contabilidad" className="mt-3 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h3 className="text-sm font-bold flex items-center gap-1"><PiggyBank className="h-4 w-4 text-primary" />Contabilidad de Ventas</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs"><CalendarIcon className="mr-1 h-3 w-3" />{format(startDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={(d) => d && setStartDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
              <span className="text-muted-foreground text-xs">a</span>
              <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs"><CalendarIcon className="mr-1 h-3 w-3" />{format(endDate, "dd/MM/yy")}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={(d) => d && setEndDate(d)} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(startOfMonth(new Date())); setEndDate(endOfMonth(new Date())); }}>Mes</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(subMonths(startOfMonth(new Date()), 2)); setEndDate(endOfMonth(new Date())); }}>3M</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setStartDate(startOfYear(new Date())); setEndDate(endOfMonth(new Date())); }}>Año</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportCSV}><FileSpreadsheet className="h-3 w-3 mr-1" />CSV</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportPDF}><FileDown className="h-3 w-3 mr-1" />PDF</Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-l-4 border-l-primary"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Total Ingresos</p><DollarSign className="h-3.5 w-3.5 text-primary" /></div><p className="text-lg font-bold mt-1">${balance.totalIncome.toLocaleString()}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-2))]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Vendidos</p><ShoppingCart className="h-3.5 w-3.5 text-[hsl(var(--chart-2))]" /></div><p className="text-lg font-bold mt-1">{balance.count}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-3))]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Planes</p><Ticket className="h-3.5 w-3.5 text-[hsl(var(--chart-3))]" /></div><p className="text-lg font-bold mt-1">{profileBreakdown.length}</p></CardContent></Card>
            <Card className="border-l-4 border-l-[hsl(var(--chart-4))]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-medium text-muted-foreground">Revendedores</p><Users className="h-3.5 w-3.5 text-[hsl(var(--chart-4))]" /></div><p className="text-lg font-bold mt-1">{resellers.length}</p></CardContent></Card>
          </div>

          {/* Chart */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ingresos Mensuales</CardTitle></CardHeader><CardContent>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} formatter={(v: number) => [`$${v.toLocaleString()}`, ""]} />
                  <Bar dataKey="vouchers" name="Ingresos" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">Sin datos</div>}
          </CardContent></Card>

          {/* Sales Table */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Últimas Ventas</CardTitle></CardHeader><CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow>
                <TableHead className="text-[10px]">Fecha</TableHead><TableHead className="text-[10px]">Voucher</TableHead>
                <TableHead className="text-[10px]">Plan</TableHead><TableHead className="text-[10px] text-right">Monto</TableHead>
              </TableRow></TableHeader><TableBody>
                {movements.length > 0 ? movements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[10px] whitespace-nowrap">{format(new Date(m.date), "dd/MM/yy HH:mm")}</TableCell>
                    <TableCell className="text-xs">{m.description}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{m.profile}</Badge></TableCell>
                    <TableCell className="text-right text-xs font-medium text-[hsl(var(--chart-2))]">+${m.amount.toLocaleString()}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs">Sin ventas</TableCell></TableRow>}
              </TableBody></Table>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* ═══ REPORTES TAB ═══ */}
        <TabsContent value="reportes" className="mt-3 space-y-4">
          <h3 className="text-sm font-bold flex items-center gap-1"><BarChart3 className="h-4 w-4 text-primary" />Reportes y Dashboard</h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Profile Breakdown Pie */}
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Ventas por Plan</CardTitle></CardHeader><CardContent>
              {profileBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={profileBreakdown} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, revenue }) => `${name}: $${revenue}`}>
                      {profileBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, "Ingreso"]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">Sin datos</div>}
            </CardContent></Card>

            {/* Monthly Trend */}
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Vouchers Vendidos por Mes</CardTitle></CardHeader><CardContent>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="Cantidad" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">Sin datos</div>}
            </CardContent></Card>
          </div>

          {/* Reseller Report */}
          {resellerReport.length > 0 && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Reporte de Revendedores</CardTitle></CardHeader><CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {resellerReport.map(r => (
                  <Card key={r.id} className="border"><CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Users className="h-4 w-4 text-primary" /></div><div><p className="font-medium text-xs">{r.name}</p><p className="text-[10px] text-muted-foreground">{r.email}</p></div></div>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div className="p-1.5 bg-muted/50 rounded"><p className="text-[10px] text-muted-foreground">Ventas</p><p className="font-bold">{r.salesCount}</p></div>
                      <div className="p-1.5 bg-muted/50 rounded"><p className="text-[10px] text-muted-foreground">Total</p><p className="font-bold">${r.totalSales.toLocaleString()}</p></div>
                      <div className="p-1.5 bg-[hsl(var(--chart-4))]/10 rounded"><p className="text-[10px] text-muted-foreground">Comisión ({r.commissionRate}%)</p><p className="font-bold text-[hsl(var(--chart-4))]">${r.commission.toFixed(0)}</p></div>
                      <div className="p-1.5 bg-[hsl(var(--chart-2))]/10 rounded"><p className="text-[10px] text-muted-foreground">Neto</p><p className="font-bold text-[hsl(var(--chart-2))]">${r.netIncome.toFixed(0)}</p></div>
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ═══ DIALOGS ═══ */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Agregar Usuario</DialogTitle><DialogDescription>PIN automático o usuario/contraseña manual</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={authMode === "pin" ? "default" : "outline"} size="sm" onClick={() => setAuthMode("pin")}><Key className="h-3.5 w-3.5 mr-1" />PIN</Button>
              <Button variant={authMode === "userpass" ? "default" : "outline"} size="sm" onClick={() => setAuthMode("userpass")}><UserPlus className="h-3.5 w-3.5 mr-1" />Usuario/Contraseña</Button>
            </div>
            {authMode === "userpass" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Usuario *</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-8 text-xs" /></div>
                <div className="space-y-1"><Label className="text-xs">Contraseña *</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} className="h-8 text-xs" /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Perfil</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{profiles.length > 0 ? profiles.map((p: any) => <SelectItem key={p[".id"]} value={p.name} className="text-xs">{p.name}</SelectItem>) : <SelectItem value="default">default</SelectItem>}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Comentario</Label><Input value={comment} onChange={(e) => setComment(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleAddUser} disabled={addUserMutation.isPending}>{addUserMutation.isPending ? "Creando..." : "Crear"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchPin} onOpenChange={setShowBatchPin}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5" />Crear PINs en Lote</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} max={100} value={pinCount} onChange={(e) => setPinCount(parseInt(e.target.value) || 1)} className="h-8 text-xs" /></div>
              <div className="space-y-1">
                <Label className="text-xs">Perfil</Label>
                <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{profiles.length > 0 ? profiles.map((p: any) => <SelectItem key={p[".id"]} value={p.name} className="text-xs">{p.name}</SelectItem>) : <SelectItem value="default">default</SelectItem>}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowBatchPin(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => batchPinMutation.mutate(pinCount)} disabled={batchPinMutation.isPending}>{batchPinMutation.isPending ? "Creando..." : `Crear ${pinCount} PINs`}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preset Dialog */}
      <Dialog open={showAddPreset} onOpenChange={(o) => { setShowAddPreset(o); if (!o) setEditPreset(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />{editPreset ? "Editar Plan" : "Nuevo Plan"}</DialogTitle><DialogDescription>Define duración, precio y descripción del plan WiFi</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="ej: 1h-5Mbps" className="h-8 text-xs" /></div>
              <div className="space-y-1">
                <Label className="text-xs">Duración</Label>
                <Select value={presetValidity} onValueChange={setPresetValidity}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30m">30 minutos</SelectItem>
                    <SelectItem value="1h">1 hora</SelectItem>
                    <SelectItem value="2h">2 horas</SelectItem>
                    <SelectItem value="3h">3 horas</SelectItem>
                    <SelectItem value="6h">6 horas</SelectItem>
                    <SelectItem value="12h">12 horas</SelectItem>
                    <SelectItem value="24h">1 día</SelectItem>
                    <SelectItem value="3d">3 días</SelectItem>
                    <SelectItem value="7d">1 semana</SelectItem>
                    <SelectItem value="15d">15 días</SelectItem>
                    <SelectItem value="30d">1 mes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Precio ($)</Label><Input type="number" min={0} step={0.5} value={presetPrice} onChange={(e) => setPresetPrice(parseFloat(e.target.value) || 0)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label className="text-xs">Descripción / Velocidad</Label><Input value={presetDesc} onChange={(e) => setPresetDesc(e.target.value)} placeholder="ej: 5M/3M" className="h-8 text-xs" /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowAddPreset(false); setEditPreset(null); }}>Cancelar</Button>
              <Button size="sm" onClick={handleSavePreset} disabled={isCreatingPreset}>{isCreatingPreset ? "Guardando..." : editPreset ? "Actualizar" : "Crear Plan"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle><AlertDialogDescription>Se eliminará del MikroTik permanentemente.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteUserMutation.mutate(deleteId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VoucherQRDialog voucher={qrDialogVoucher} hotspotUrl={hotspotUrl} open={!!qrDialogVoucher} onOpenChange={(o) => !o && setQrDialogVoucher(null)} />
    </div>
  );
}
