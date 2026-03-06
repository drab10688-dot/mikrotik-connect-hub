import { useState, useEffect } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Plus, Wifi, Trash2, Edit, FileText, Router, Eye, EyeOff, Copy, RotateCcw, Signal, Power, Loader2, Link, LinkIcon, Unlink, Download, Activity, Upload, Send, Settings2 } from "lucide-react";
// TR069Dashboard removed - replaced by CMS C-Data
import SignalHistoryChart from "@/components/onu/SignalHistoryChart";
import { useValidatedDevice } from "@/hooks/useValidatedDevice";

interface OnuDevice {
  id: string;
  mikrotik_id: string;
  client_id: string | null;
  serial_number: string;
  mac_address: string | null;
  brand: string;
  model: string | null;
  management_ip: string | null;
  olt_port: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  pppoe_username: string | null;
  pppoe_password: string | null;
  pppoe_profile: string | null;
  status: string;
  notes: string | null;
  client_name?: string;
  client_username?: string;
  plan_or_speed?: string;
  acs_device_id: string | null;
  acs_linked_at: string | null;
  acs_manufacturer: string | null;
  acs_model: string | null;
  acs_firmware: string | null;
  created_at: string;
}

interface UnregisteredDevice {
  serial: string;
  deviceId: string;
  manufacturer: string;
  model: string | null;
  firmware: string | null;
  lastInform: string | null;
}

interface ConfigTemplate {
  id: string;
  name: string;
  brand: string;
  template_content: string;
  file_format: string;
  description: string | null;
  is_default: boolean;
}

// GenieACS file interface removed

const brandOptions = [
  { value: "latic", label: "Latic" },
  { value: "zte", label: "ZTE" },
  { value: "huawei", label: "Huawei" },
  { value: "zyxel", label: "Zyxel" },
];

const statusColors: Record<string, string> = {
  registered: "bg-muted text-muted-foreground",
  provisioned: "bg-primary/20 text-primary",
  active: "bg-accent/20 text-accent-foreground",
  inactive: "bg-destructive/20 text-destructive",
};

export default function OnuManagement() {
  const { device, isValidating, hasValidDevice } = useValidatedDevice(true);
  const mikrotikId = device?.id || localStorage.getItem("mikrotik_device_id") || "";
  const [onus, setOnus] = useState<OnuDevice[]>([]);
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddOnu, setShowAddOnu] = useState(false);
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [showWifiDialog, setShowWifiDialog] = useState(false);
  const [selectedOnu, setSelectedOnu] = useState<OnuDevice | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [clients, setClients] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [unregistered, setUnregistered] = useState<UnregisteredDevice[]>([]);
  const [syncStats, setSyncStats] = useState<{ linked: number; updated: number; newDevices: number } | null>(null);
  // acsFiles state removed
  const [showUploadFile, setShowUploadFile] = useState(false);
  const [showPushConfig, setShowPushConfig] = useState(false);
  const [pushTargetOnu, setPushTargetOnu] = useState<OnuDevice | null>(null);
  const [uploadForm, setUploadForm] = useState({ fileName: "", oui: "", productClass: "", version: "", content: "" });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pushingConfig, setPushingConfig] = useState(false);

  // Form state
  const [form, setForm] = useState({
    serial_number: "", mac_address: "", brand: "latic", model: "",
    management_ip: "", olt_port: "", wifi_ssid: "", wifi_password: "",
    pppoe_username: "", pppoe_password: "", pppoe_profile: "",
    client_id: "", notes: "", auto_create_pppoe: false,
    vlan_id: "", dns1: "", dns2: "",
  });

  const [wifiForm, setWifiForm] = useState({ wifi_ssid: "", wifi_password: "" });
  const [templateForm, setTemplateForm] = useState({
    name: "", brand: "latic", template_content: "", file_format: "xml", description: "",
  });

  const loadData = async () => {
    if (!mikrotikId) return;
    setLoading(true);
    try {
      const [onuRes, templatesRes, clientsRes] = await Promise.all([
        api(`/onu/${mikrotikId}`),
        api(`/onu/${mikrotikId}/templates/list`),
        api(`/clients/${mikrotikId}`).catch(() => ({ data: [] })),
      ]);
      setOnus(onuRes.data || []);
      setTemplates(templatesRes.data || []);
      setClients(clientsRes.data || []);

      // Load PPPoE profiles
      try {
        const profilesRes = await api(`/pppoe/${mikrotikId}/profiles`);
        setProfiles((profilesRes.data || []).map((p: any) => p.name));
      } catch { setProfiles([]); }

      // GenieACS files loading removed
    } catch (err: any) {
      toast.error("Error cargando ONUs: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [mikrotikId]);

  const handleSyncACS = async () => {
    setSyncLoading(true);
    try {
      const res = await api(`/genieacs/auto-sync/${mikrotikId}`, { method: "POST" });
      setSyncStats({ linked: res.linked, updated: res.updated, newDevices: res.newDevices });
      setUnregistered(res.unregistered || []);
      if (res.linked > 0) {
        toast.success(`${res.linked} ONUs vinculadas automáticamente`);
        loadData();
      } else if (res.newDevices > 0) {
        toast.info(`${res.newDevices} ONUs detectadas en ACS sin registrar`);
      } else {
        toast.info(res.message);
      }
    } catch (err: any) {
      toast.error("Error sincronizando: " + err.message);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleAutoRegister = async (devices: UnregisteredDevice[]) => {
    setSyncLoading(true);
    try {
      const res = await api(`/genieacs/auto-register/${mikrotikId}`, {
        method: "POST",
        body: { devices },
      });
      toast.success(res.message);
      setUnregistered([]);
      setSyncStats(null);
      loadData();
    } catch (err: any) {
      toast.error("Error registrando: " + err.message);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleAddOnu = async () => {
    try {
      const res = await api(`/onu/${mikrotikId}`, {
        method: "POST",
        body: { ...form, client_id: form.client_id || null },
      });
      if (res.warning) toast.warning(res.warning);
      else toast.success("ONU registrada exitosamente");

      // Auto-provision via TR-069 if enabled
      if (form.auto_provision_tr069 && form.serial_number && (form.wifi_ssid || form.pppoe_username)) {
        try {
          const provRes = await api("/genieacs/auto-provision", {
            method: "POST",
            body: {
              serialNumber: form.serial_number,
              wifiSsid: form.wifi_ssid || undefined,
              wifiPassword: form.wifi_password || undefined,
              pppoeUsername: form.pppoe_username || undefined,
              pppoePassword: form.pppoe_password || undefined,
              vlanId: form.vlan_id || undefined,
              dns1: form.dns1 || undefined,
              dns2: form.dns2 || undefined,
            },
          });
          if (provRes.found) {
            toast.success(`TR-069: ${provRes.message}`);
          } else {
            toast.info(provRes.message);
          }
        } catch (provErr: any) {
          toast.warning(`ONU registrada pero auto-provisioning TR-069 falló: ${provErr.message}`);
        }
      }

      setShowAddOnu(false);
      setForm({
        serial_number: "", mac_address: "", brand: "latic", model: "",
        management_ip: "", olt_port: "", wifi_ssid: "", wifi_password: "",
        pppoe_username: "", pppoe_password: "", pppoe_profile: "",
        client_id: "", notes: "", auto_create_pppoe: false, auto_provision_tr069: false,
        vlan_id: "", dns1: "", dns2: "",
      });
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteOnu = async (onuId: string) => {
    if (!confirm("¿Eliminar esta ONU?")) return;
    try {
      await api(`/onu/${mikrotikId}/${onuId}`, { method: "DELETE" });
      toast.success("ONU eliminada");
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleChangeWifi = async () => {
    if (!selectedOnu) return;
    try {
      const res = await api(`/onu/${mikrotikId}/${selectedOnu.id}/wifi`, {
        method: "POST",
        body: wifiForm,
      });
      toast.success(res.message || "WiFi actualizado");
      setShowWifiDialog(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAddTemplate = async () => {
    try {
      await api(`/onu/${mikrotikId}/templates`, {
        method: "POST",
        body: templateForm,
      });
      toast.success("Plantilla guardada");
      setShowAddTemplate(false);
      setTemplateForm({ name: "", brand: "latic", template_content: "", file_format: "xml", description: "" });
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("¿Eliminar esta plantilla?")) return;
    try {
      await api(`/onu/${mikrotikId}/templates/${id}`, { method: "DELETE" });
      toast.success("Plantilla eliminada");
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUploadToACS = async () => {
    if (!uploadForm.fileName || !uploadForm.content) return;
    setUploadingFile(true);
    try {
      await api('/genieacs/files/upload', {
        method: 'POST',
        body: {
          fileName: uploadForm.fileName,
          fileType: '3 Vendor Configuration File',
          oui: uploadForm.oui || undefined,
          productClass: uploadForm.productClass || undefined,
          version: uploadForm.version || undefined,
          content: uploadForm.content,
        },
      });
      toast.success(`Archivo "${uploadForm.fileName}" subido a GenieACS`);
      setShowUploadFile(false);
      setUploadForm({ fileName: "", oui: "", productClass: "", version: "", content: "" });
      loadData();
    } catch (err: any) {
      toast.error("Error subiendo archivo: " + err.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleUploadTemplateToACS = async (template: ConfigTemplate) => {
    try {
      await api('/genieacs/files/upload', {
        method: 'POST',
        body: {
          fileName: `${template.brand}-${template.name.replace(/\s+/g, '-').toLowerCase()}.${template.file_format}`,
          fileType: '3 Vendor Configuration File',
          content: template.template_content,
        },
      });
      toast.success(`Plantilla "${template.name}" subida a GenieACS`);
      loadData();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  const handleDeleteACSFile = async (fileId: string) => {
    if (!confirm("¿Eliminar este archivo de GenieACS?")) return;
    try {
      await api(`/genieacs/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      toast.success("Archivo eliminado");
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handlePushConfig = async (deviceId: string, fileName: string) => {
    setPushingConfig(true);
    try {
      const res = await api(`/genieacs/devices/${encodeURIComponent(deviceId)}/push-config`, {
        method: "POST",
        body: { fileName },
      });
      toast.success(res.message);
      setShowPushConfig(false);
      setPushTargetOnu(null);
    } catch (err: any) {
      toast.error("Error enviando config: " + err.message);
    } finally {
      setPushingConfig(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadForm(p => ({
        ...p,
        fileName: p.fileName || file.name,
        content: reader.result as string,
      }));
    };
    reader.readAsText(file);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  const togglePassword = (id: string) => {
    setShowPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };


  if (isValidating) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!hasValidDevice || !mikrotikId) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Seleccione un dispositivo MikroTik primero</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Gestión de ONUs</h1>
            <p className="text-muted-foreground">Registre, provisione y gestione sus ONUs de fibra óptica</p>
          </div>
        </div>

        <Tabs defaultValue="devices" className="space-y-4">
          <TabsList>
            <TabsTrigger value="devices">
              <Router className="w-4 h-4 mr-2" />
              ONUs ({onus.length})
            </TabsTrigger>
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-2" />
              Plantillas ({templates.length})
            </TabsTrigger>
            <TabsTrigger value="tr069">
              <Signal className="w-4 h-4 mr-2" />
              TR-069
            </TabsTrigger>
            <TabsTrigger value="signal">
              <Activity className="w-4 h-4 mr-2" />
              Señal Óptica
            </TabsTrigger>
          </TabsList>

          {/* ─── ONUs Tab ─────────────────────────────── */}
          <TabsContent value="devices" className="space-y-4">
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={handleSyncACS} disabled={syncLoading}>
                {syncLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                Sincronizar con ACS
              </Button>
              <Dialog open={showAddOnu} onOpenChange={setShowAddOnu}>
                <DialogTrigger asChild>
                  <Button><Plus className="w-4 h-4 mr-2" /> Registrar ONU</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Registrar Nueva ONU</DialogTitle>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Número de Serie *</Label>
                      <Input value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} placeholder="ZTEG12345678" />
                    </div>
                    <div className="space-y-2">
                      <Label>MAC Address</Label>
                      <Input value={form.mac_address} onChange={e => setForm(p => ({ ...p, mac_address: e.target.value }))} placeholder="AA:BB:CC:DD:EE:FF" />
                    </div>
                    <div className="space-y-2">
                      <Label>Marca *</Label>
                      <Select value={form.brand} onValueChange={v => setForm(p => ({ ...p, brand: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {brandOptions.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Modelo</Label>
                      <Input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} placeholder="F660 v8" />
                    </div>
                    <div className="space-y-2">
                      <Label>IP de Gestión</Label>
                      <Input value={form.management_ip} onChange={e => setForm(p => ({ ...p, management_ip: e.target.value }))} placeholder="192.168.1.1" />
                    </div>
                    <div className="space-y-2">
                      <Label>Puerto OLT</Label>
                      <Input value={form.olt_port} onChange={e => setForm(p => ({ ...p, olt_port: e.target.value }))} placeholder="1/1/1" />
                    </div>

                    <div className="col-span-2 border-t pt-4">
                      <h4 className="font-semibold text-sm text-muted-foreground mb-3">Configuración WiFi</h4>
                    </div>
                    <div className="space-y-2">
                      <Label>SSID (Nombre WiFi)</Label>
                      <Input value={form.wifi_ssid} onChange={e => setForm(p => ({ ...p, wifi_ssid: e.target.value }))} placeholder="MiRedFibra" />
                    </div>
                    <div className="space-y-2">
                      <Label>Contraseña WiFi</Label>
                      <Input value={form.wifi_password} onChange={e => setForm(p => ({ ...p, wifi_password: e.target.value }))} placeholder="********" />
                    </div>

                    <div className="col-span-2 border-t pt-4">
                      <h4 className="font-semibold text-sm text-muted-foreground mb-3">Configuración PPPoE</h4>
                    </div>
                    <div className="space-y-2">
                      <Label>Usuario PPPoE</Label>
                      <Input value={form.pppoe_username} onChange={e => setForm(p => ({ ...p, pppoe_username: e.target.value }))} placeholder="cliente01" />
                    </div>
                    <div className="space-y-2">
                      <Label>Contraseña PPPoE</Label>
                      <Input value={form.pppoe_password} onChange={e => setForm(p => ({ ...p, pppoe_password: e.target.value }))} placeholder="********" />
                    </div>
                    <div className="space-y-2">
                      <Label>Perfil PPPoE</Label>
                      <Select value={form.pppoe_profile} onValueChange={v => setForm(p => ({ ...p, pppoe_profile: v }))}>
                        <SelectTrigger><SelectValue placeholder="Seleccionar perfil" /></SelectTrigger>
                        <SelectContent>
                          {profiles.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Cliente ISP</Label>
                      <Select value={form.client_id} onValueChange={v => setForm(p => ({ ...p, client_id: v }))}>
                        <SelectTrigger><SelectValue placeholder="Vincular a cliente" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Sin vincular</SelectItem>
                          {clients.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.client_name} ({c.username})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-2 flex items-center gap-3 border-t pt-4">
                      <Switch
                        checked={form.auto_create_pppoe}
                        onCheckedChange={v => setForm(p => ({ ...p, auto_create_pppoe: v }))}
                      />
                      <Label>Crear secreto PPPoE automáticamente en MikroTik</Label>
                    </div>

                    <div className="col-span-2 flex items-center gap-3">
                      <Switch
                        checked={form.auto_provision_tr069}
                        onCheckedChange={v => setForm(p => ({ ...p, auto_provision_tr069: v }))}
                      />
                      <div>
                        <Label>Auto-aprovisionar via TR-069 (GenieACS)</Label>
                        <p className="text-xs text-muted-foreground">Envía WiFi, PPPoE y VLAN a la ONU automáticamente vía CWMP</p>
                      </div>
                    </div>

                    {form.auto_provision_tr069 && (
                      <div className="col-span-2 grid grid-cols-3 gap-4 bg-muted/50 p-4 rounded-lg">
                        <div className="space-y-2">
                          <Label className="text-xs">VLAN ID</Label>
                          <Input value={form.vlan_id} onChange={e => setForm(p => ({ ...p, vlan_id: e.target.value }))} placeholder="100" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">DNS Primario</Label>
                          <Input value={form.dns1} onChange={e => setForm(p => ({ ...p, dns1: e.target.value }))} placeholder="8.8.8.8" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">DNS Secundario</Label>
                          <Input value={form.dns2} onChange={e => setForm(p => ({ ...p, dns2: e.target.value }))} placeholder="8.8.4.4" />
                        </div>
                      </div>
                    )}

                    <div className="col-span-2 space-y-2">
                      <Label>Notas</Label>
                      <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notas adicionales..." />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setShowAddOnu(false)}>Cancelar</Button>
                    <Button onClick={handleAddOnu} disabled={!form.serial_number || !form.brand}>
                      Registrar ONU
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Unregistered ACS devices */}
            {unregistered.length > 0 && (
              <Card className="border-dashed border-primary/50">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Download className="w-4 h-4 text-primary" />
                      {unregistered.length} ONUs detectadas en ACS sin registrar
                    </CardTitle>
                    <Button size="sm" onClick={() => handleAutoRegister(unregistered)} disabled={syncLoading}>
                      {syncLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      Registrar Todas
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Serial</TableHead>
                        <TableHead className="text-xs">Fabricante</TableHead>
                        <TableHead className="text-xs">Modelo</TableHead>
                        <TableHead className="text-xs">Firmware</TableHead>
                        <TableHead className="text-xs">Último INFORM</TableHead>
                        <TableHead className="text-xs text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unregistered.map((d) => (
                        <TableRow key={d.deviceId}>
                          <TableCell className="font-mono text-xs">{d.serial}</TableCell>
                          <TableCell className="text-xs">{d.manufacturer}</TableCell>
                          <TableCell className="text-xs">{d.model || "-"}</TableCell>
                          <TableCell className="text-xs">{d.firmware || "-"}</TableCell>
                          <TableCell className="text-xs">{d.lastInform ? new Date(d.lastInform).toLocaleString() : "-"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => handleAutoRegister([d])}>
                              <Plus className="w-3 h-3 mr-1" /> Registrar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {loading ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">Cargando...</CardContent></Card>
            ) : onus.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">No hay ONUs registradas</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Serial</TableHead>
                          <TableHead>Marca/Modelo</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>WiFi</TableHead>
                          <TableHead>PPPoE</TableHead>
                          <TableHead>ACS</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onus.map(onu => (
                          <TableRow key={onu.id}>
                            <TableCell className="font-mono text-xs">{onu.serial_number}</TableCell>
                            <TableCell>
                              <span className="capitalize font-medium">{onu.brand}</span>
                              {onu.model && <span className="text-muted-foreground text-xs ml-1">{onu.model}</span>}
                            </TableCell>
                            <TableCell>
                              {onu.client_name ? (
                                <div>
                                  <div className="text-sm font-medium">{onu.client_name}</div>
                                  <div className="text-xs text-muted-foreground">{onu.client_username}</div>
                                </div>
                              ) : <span className="text-muted-foreground text-xs">Sin vincular</span>}
                            </TableCell>
                            <TableCell>
                              {onu.wifi_ssid ? (
                                <div className="flex items-center gap-1">
                                  <Wifi className="w-3 h-3 text-primary" />
                                  <span className="text-xs">{onu.wifi_ssid}</span>
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(onu.wifi_password || "")}>
                                    <Copy className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : <span className="text-muted-foreground text-xs">-</span>}
                            </TableCell>
                            <TableCell>
                              {onu.pppoe_username ? (
                                <div className="flex items-center gap-1">
                                  <span className="font-mono text-xs">{onu.pppoe_username}</span>
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => togglePassword(onu.id)}>
                                    {showPasswords[onu.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  </Button>
                                  {showPasswords[onu.id] && (
                                    <span className="font-mono text-xs text-muted-foreground">{onu.pppoe_password}</span>
                                  )}
                                </div>
                              ) : <span className="text-muted-foreground text-xs">-</span>}
                            </TableCell>
                            <TableCell>
                              {onu.acs_device_id ? (
                                <div className="flex items-center gap-1" title={`ACS: ${onu.acs_manufacturer || ''} ${onu.acs_model || ''}\nFirmware: ${onu.acs_firmware || '-'}\nVinculado: ${onu.acs_linked_at ? new Date(onu.acs_linked_at).toLocaleDateString() : '-'}`}>
                                  <LinkIcon className="w-3 h-3 text-chart-2" />
                                  <span className="text-xs text-chart-2">Vinculada</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Unlink className="w-3 h-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">No</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[onu.status] || ""}>{onu.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost" size="icon" className="h-8 w-8"
                                  title="Cambiar WiFi"
                                  onClick={() => {
                                    setSelectedOnu(onu);
                                    setWifiForm({ wifi_ssid: onu.wifi_ssid || "", wifi_password: onu.wifi_password || "" });
                                    setShowWifiDialog(true);
                                  }}
                                >
                                  <Wifi className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-8 w-8"
                                  title="Auto-provisionar via TR-069"
                                  onClick={async () => {
                                    if (!onu.wifi_ssid && !onu.pppoe_username) {
                                      toast.error("La ONU no tiene WiFi ni PPPoE configurado para enviar");
                                      return;
                                    }
                                    try {
                                      const provRes = await api("/genieacs/auto-provision", {
                                        method: "POST",
                                        body: {
                                          serialNumber: onu.serial_number,
                                          wifiSsid: onu.wifi_ssid || undefined,
                                          wifiPassword: onu.wifi_password || undefined,
                                          pppoeUsername: onu.pppoe_username || undefined,
                                          pppoePassword: onu.pppoe_password || undefined,
                                        },
                                      });
                                      if (provRes.found) toast.success(provRes.message);
                                      else toast.info(provRes.message);
                                    } catch (err: any) {
                                      toast.error("Error TR-069: " + err.message);
                                    }
                                  }}
                                >
                                  <Signal className="w-4 h-4" />
                                </Button>
                                {onu.acs_device_id && acsFiles.length > 0 && (
                                  <Button
                                    variant="ghost" size="icon" className="h-8 w-8"
                                    title="Enviar archivo de configuración via TR-069"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPushTargetOnu(onu);
                                      setShowPushConfig(true);
                                    }}
                                  >
                                    <Upload className="w-4 h-4" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteOnu(onu.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── Templates Tab ────────────────────────── */}
          <TabsContent value="templates" className="space-y-4">
            <div className="flex justify-end">
              <Dialog open={showAddTemplate} onOpenChange={setShowAddTemplate}>
                <DialogTrigger asChild>
                  <Button><Plus className="w-4 h-4 mr-2" /> Nueva Plantilla</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Nueva Plantilla de Configuración</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Nombre *</Label>
                        <Input value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))} placeholder="Config Base ZTE F660" />
                      </div>
                      <div className="space-y-2">
                        <Label>Marca *</Label>
                        <Select value={templateForm.brand} onValueChange={v => setTemplateForm(p => ({ ...p, brand: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {brandOptions.map(b => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Formato</Label>
                        <Select value={templateForm.file_format} onValueChange={v => setTemplateForm(p => ({ ...p, file_format: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="xml">XML</SelectItem>
                            <SelectItem value="text">Texto Plano</SelectItem>
                            <SelectItem value="json">JSON</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Descripción</Label>
                        <Input value={templateForm.description} onChange={e => setTemplateForm(p => ({ ...p, description: e.target.value }))} placeholder="Configuración estándar..." />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Contenido de la Plantilla *</Label>
                      <Textarea
                        value={templateForm.template_content}
                        onChange={e => setTemplateForm(p => ({ ...p, template_content: e.target.value }))}
                        placeholder="Pegue aquí el contenido XML/texto de la configuración..."
                        className="font-mono text-xs min-h-[200px]"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setShowAddTemplate(false)}>Cancelar</Button>
                    <Button onClick={handleAddTemplate} disabled={!templateForm.name || !templateForm.template_content}>
                      Guardar Plantilla
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {templates.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">No hay plantillas de configuración</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map(t => (
                  <Card key={t.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{t.name}</CardTitle>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteTemplate(t.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2 mb-2">
                        <Badge variant="outline" className="capitalize">{t.brand}</Badge>
                        <Badge variant="secondary">{t.file_format.toUpperCase()}</Badge>
                      </div>
                      {t.description && <p className="text-xs text-muted-foreground mb-2">{t.description}</p>}
                      <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-24 font-mono">
                        {t.template_content.substring(0, 200)}{t.template_content.length > 200 ? "..." : ""}
                      </pre>
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => copyToClipboard(t.template_content)}>
                          <Copy className="w-3 h-3 mr-1" /> Copiar
                        </Button>
                        <Button variant="default" size="sm" className="flex-1" onClick={() => handleUploadTemplateToACS(t)}>
                          <Upload className="w-3 h-3 mr-1" /> Subir a ACS
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* ─── GenieACS Files ─────────────────────── */}
            <Card>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Archivos en GenieACS ({acsFiles.length})
                  </CardTitle>
                  <Button size="sm" onClick={() => setShowUploadFile(true)}>
                    <Upload className="w-4 h-4 mr-2" /> Subir Archivo
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Archivos de configuración disponibles para enviar a ONUs via TR-069
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {acsFiles.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No hay archivos en GenieACS. Suba una plantilla o un archivo de configuración.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Nombre</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs">OUI</TableHead>
                        <TableHead className="text-xs">Tamaño</TableHead>
                        <TableHead className="text-xs text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {acsFiles.map(f => (
                        <TableRow key={f.id}>
                          <TableCell className="font-mono text-xs">{f.filename || f.id}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline">{f.metadata?.fileType || "Config"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{f.metadata?.oui || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {f.length ? `${(f.length / 1024).toFixed(1)} KB` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteACSFile(f.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── TR-069 Tab ───────────────────────────── */}
          <TabsContent value="tr069" className="space-y-4">
            <TR069Dashboard />
          </TabsContent>

          {/* ─── Signal History Tab ───────────────────── */}
          <TabsContent value="signal">
            <SignalHistoryChart mikrotikId={mikrotikId} />
          </TabsContent>
        </Tabs>

        {/* ─── WiFi Change Dialog ─────────────────────── */}
        <Dialog open={showWifiDialog} onOpenChange={setShowWifiDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <Wifi className="w-5 h-5 inline mr-2" />
                Cambiar WiFi - {selectedOnu?.serial_number}
              </DialogTitle>
            </DialogHeader>
            {selectedOnu && (
              <div className="space-y-4">
                <div className="bg-muted/50 p-3 rounded text-sm">
                  <p><span className="font-medium">Marca:</span> <span className="capitalize">{selectedOnu.brand}</span></p>
                  <p><span className="font-medium">IP Gestión:</span> {selectedOnu.management_ip || "No configurada"}</p>
                  {selectedOnu.client_name && <p><span className="font-medium">Cliente:</span> {selectedOnu.client_name}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Nuevo SSID (Nombre WiFi)</Label>
                  <Input value={wifiForm.wifi_ssid} onChange={e => setWifiForm(p => ({ ...p, wifi_ssid: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Nueva Contraseña WiFi</Label>
                  <Input value={wifiForm.wifi_password} onChange={e => setWifiForm(p => ({ ...p, wifi_password: e.target.value }))} />
                </div>
                {!selectedOnu.management_ip && (
                  <p className="text-xs text-destructive">⚠️ Sin IP de gestión. La configuración se guardará para aplicar manualmente.</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowWifiDialog(false)}>Cancelar</Button>
                  <Button onClick={handleChangeWifi} disabled={!wifiForm.wifi_ssid && !wifiForm.wifi_password}>
                    <Wifi className="w-4 h-4 mr-2" /> Aplicar Cambio
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ─── Upload File to ACS Dialog ─────────────── */}
        <Dialog open={showUploadFile} onOpenChange={setShowUploadFile}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Subir Archivo a GenieACS
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-muted/50 p-3 rounded text-sm text-muted-foreground">
                Suba un archivo de configuración (.xml, .json, .cfg) que podrá enviar a las ONUs via TR-069.
              </div>

              <div className="space-y-2">
                <Label>Seleccionar archivo</Label>
                <Input type="file" accept=".xml,.json,.cfg,.txt,.conf" onChange={handleFileInput} />
              </div>

              <div className="space-y-2">
                <Label>Nombre del archivo en ACS *</Label>
                <Input
                  value={uploadForm.fileName}
                  onChange={e => setUploadForm(p => ({ ...p, fileName: e.target.value }))}
                  placeholder="zyxel-config-hotspot.json"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">OUI (opcional)</Label>
                  <Input
                    value={uploadForm.oui}
                    onChange={e => setUploadForm(p => ({ ...p, oui: e.target.value }))}
                    placeholder="00259E"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Product Class</Label>
                  <Input
                    value={uploadForm.productClass}
                    onChange={e => setUploadForm(p => ({ ...p, productClass: e.target.value }))}
                    placeholder="PMG5317"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Versión</Label>
                  <Input
                    value={uploadForm.version}
                    onChange={e => setUploadForm(p => ({ ...p, version: e.target.value }))}
                    placeholder="1.0"
                    className="text-xs"
                  />
                </div>
              </div>

              {uploadForm.content && (
                <div className="space-y-2">
                  <Label className="text-xs">Vista previa ({(uploadForm.content.length / 1024).toFixed(1)} KB)</Label>
                  <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-32 font-mono">
                    {uploadForm.content.substring(0, 500)}{uploadForm.content.length > 500 ? "\n..." : ""}
                  </pre>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowUploadFile(false)}>Cancelar</Button>
                <Button onClick={handleUploadToACS} disabled={!uploadForm.fileName || !uploadForm.content || uploadingFile}>
                  {uploadingFile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Subir a GenieACS
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ─── Push Config to ONU Dialog ──────────────── */}
        <Dialog open={showPushConfig} onOpenChange={(v) => { setShowPushConfig(v); if (!v) setPushTargetOnu(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Enviar Configuración a ONU
              </DialogTitle>
            </DialogHeader>
            {pushTargetOnu && (
              <div className="space-y-4">
                <div className="bg-muted/50 p-3 rounded text-sm">
                  <p><span className="font-medium">ONU:</span> {pushTargetOnu.serial_number}</p>
                  <p><span className="font-medium">Marca:</span> <span className="capitalize">{pushTargetOnu.brand}</span> {pushTargetOnu.model || ""}</p>
                  {pushTargetOnu.client_name && <p><span className="font-medium">Cliente:</span> {pushTargetOnu.client_name}</p>}
                  <p><span className="font-medium">ACS ID:</span> <span className="font-mono text-xs">{pushTargetOnu.acs_device_id}</span></p>
                </div>

                <div className="space-y-2">
                  <Label>Seleccionar archivo de configuración</Label>
                  {acsFiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay archivos en GenieACS. Suba uno primero en la pestaña Plantillas.</p>
                  ) : (
                    <div className="space-y-2">
                      {acsFiles.map(f => (
                        <div key={f.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                          <div>
                            <p className="text-sm font-medium font-mono">{f.filename || f.id}</p>
                            <p className="text-xs text-muted-foreground">
                              {f.metadata?.fileType || "Config"} · {f.length ? `${(f.length / 1024).toFixed(1)} KB` : "—"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            disabled={pushingConfig}
                            onClick={() => handlePushConfig(pushTargetOnu.acs_device_id!, f.filename || f.id)}
                          >
                            {pushingConfig ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                            Enviar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-destructive/10 border border-destructive/20 p-3 rounded text-xs text-destructive">
                  ⚠️ La ONU aplicará la configuración y puede reiniciarse automáticamente. Esto sobreescribirá la configuración actual del equipo.
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}
