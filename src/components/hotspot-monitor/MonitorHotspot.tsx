import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { mikrotikCommandApi } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useHotspotActiveUsers, useHotspotUsers } from "@/hooks/useMikrotikData";
import { getSelectedDeviceId } from "@/lib/mikrotik";
import { Plus, Trash2, Wifi, Search, Copy, Code } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AddHotspotUserDialog } from "@/components/forms/AddHotspotUserDialog";

export function MonitorHotspot() {
  const selectedMikrotik = getSelectedDeviceId() || "";
  const [hotspotTab, setHotspotTab] = useState("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [sharedUsers, setSharedUsers] = useState("1");
  const [rateLimit, setRateLimit] = useState("");
  const [sessionTimeout, setSessionTimeout] = useState("");
  const [idleTimeout, setIdleTimeout] = useState("");

  const queryClient = useQueryClient();
  const { data: hotspotActiveData } = useHotspotActiveUsers();
  const { data: hotspotUsersData } = useHotspotUsers();
  const hotspotActive = Array.isArray(hotspotActiveData) ? hotspotActiveData : [];
  const hotspotUsers = Array.isArray(hotspotUsersData) ? hotspotUsersData : [];

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['hotspot-profiles-manage', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return [];
      const data = await mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profiles');
      return data?.data || [];
    },
    enabled: !!selectedMikrotik,
  });

  const createProfileMutation = useMutation({
    mutationFn: async () => {
      const profileData: any = { name: profileName, 'shared-users': sharedUsers };
      if (rateLimit) profileData['rate-limit'] = rateLimit;
      if (sessionTimeout) profileData['session-timeout'] = sessionTimeout;
      if (idleTimeout) profileData['idle-timeout'] = idleTimeout;
      await mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profile-add', profileData);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] }); toast.success('Perfil creado'); setShowCreateProfile(false); setProfileName(""); setSharedUsers("1"); setRateLimit(""); setSessionTimeout(""); setIdleTimeout(""); },
    onError: (error: any) => toast.error(error.message || 'Error al crear perfil'),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => mikrotikCommandApi.exec(selectedMikrotik, 'hotspot-profile-delete', { '.id': profileId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] }); toast.success('Perfil eliminado'); setDeleteProfileId(null); },
    onError: (error: any) => toast.error(error.message || 'Error'),
  });

  const onLoginScript = `:put (",remc,5000,3d,5000,,Disable,");
{:local date [ /system clock get date ];
:local year [ :pick \$date 7 11 ];
:local month [ :pick \$date 0 3 ];
:local comment [ /ip hotspot user get [/ip hotspot user find where name="\$user"] comment];
:local ucode [:pic \$comment 0 2];
:if (\$ucode = "vc" or \$ucode = "up" or \$comment = "") do={
  /sys sch add name="\$user" disable=no start-date=\$date interval="3d";
  :delay 2s;
  :local exp [ /sys sch get [ /sys sch find where name="\$user" ] next-run];
  :local getxp [len \$exp];
  :if (\$getxp = 15) do={
    :local d [:pic \$exp 0 6];
    :local t [:pic \$exp 7 16];
    :local s ("/");
    :local exp ("\$d\$s\$year \$t");
    /ip hotspot user set comment=\$exp [find where name="\$user"];
  };
  :if (\$getxp = 8) do={
    /ip hotspot user set comment="\$date \$exp" [find where name="\$user"];
  };
  :if (\$getxp > 15) do={
    /ip hotspot user set comment=\$exp [find where name="\$user"];
  };
  /sys sch remove [find where name="\$user"];
  :local mac \$"mac-address";
  :local time [/system clock get time ];
  /system script add name="\$date-|-\$time-|-\$user-|-5000-|-\$address-|-\$mac-|-3d-|-3_Dias-|-\$comment" owner="\$month\$year" source=\$date comment=omnisync
}}`;

  const filteredActive = hotspotActive.filter((u: any) => !searchTerm || (u.user || u.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || (u.address || "").includes(searchTerm));
  const filteredUsers = hotspotUsers.filter((u: any) => !searchTerm || (u.name || "").toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Wifi className="h-5 w-5 text-primary" /><h2 className="text-lg font-bold">Gestión Hotspot</h2></div>
        <AddHotspotUserDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hotspot-users'] })} />
      </div>
      <div className="relative md:w-64"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" /></div>
      <Tabs value={hotspotTab} onValueChange={setHotspotTab}>
        <TabsList className="h-8"><TabsTrigger value="active" className="text-xs">Activos ({hotspotActive.length})</TabsTrigger><TabsTrigger value="users" className="text-xs">Usuarios ({hotspotUsers.length})</TabsTrigger><TabsTrigger value="profiles" className="text-xs">Perfiles ({profiles.length})</TabsTrigger><TabsTrigger value="script" className="text-xs">Script</TabsTrigger></TabsList>
        <TabsContent value="active" className="mt-3"><Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-[10px]">Usuario</TableHead><TableHead className="text-[10px]">IP</TableHead><TableHead className="text-[10px]">MAC</TableHead><TableHead className="text-[10px]">Perfil</TableHead><TableHead className="text-[10px]">Uptime</TableHead></TableRow></TableHeader><TableBody>{filteredActive.length > 0 ? filteredActive.map((u: any, i: number) => (<TableRow key={i}><TableCell className="text-xs font-medium">{u.user || u.name || "-"}</TableCell><TableCell className="text-[10px] font-mono">{u.address || "-"}</TableCell><TableCell className="text-[10px] font-mono text-muted-foreground">{u["mac-address"] || "-"}</TableCell><TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell><TableCell className="text-[10px] text-muted-foreground">{u.uptime || "0s"}</TableCell></TableRow>)) : (<TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios activos</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
        <TabsContent value="users" className="mt-3"><Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-[10px]">Nombre</TableHead><TableHead className="text-[10px]">Perfil</TableHead><TableHead className="text-[10px]">Comentario</TableHead><TableHead className="text-[10px]">Disabled</TableHead></TableRow></TableHeader><TableBody>{filteredUsers.length > 0 ? filteredUsers.map((u: any, i: number) => (<TableRow key={i}><TableCell className="text-xs font-medium">{u.name}</TableCell><TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell><TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{u.comment || "-"}</TableCell><TableCell><Badge variant={u.disabled === "true" ? "destructive" : "default"} className="text-[9px]">{u.disabled === "true" ? "Sí" : "No"}</Badge></TableCell></TableRow>)) : (<TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
        <TabsContent value="profiles" className="mt-3 space-y-3">
          {showCreateProfile ? (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Crear Perfil</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 md:grid-cols-3 gap-3"><div className="space-y-1"><Label className="text-xs">Nombre *</Label><Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="5mbps-1hora" className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs">Usuarios Compartidos</Label><Input type="number" value={sharedUsers} onChange={(e) => setSharedUsers(e.target.value)} className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs">Rate Limit</Label><Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="5M/5M" className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs">Session Timeout</Label><Input value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} placeholder="1h" className="h-8 text-xs" /></div><div className="space-y-1"><Label className="text-xs">Idle Timeout</Label><Input value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} placeholder="5m" className="h-8 text-xs" /></div></div><div className="flex gap-2 justify-end"><Button size="sm" variant="outline" onClick={() => setShowCreateProfile(false)}>Cancelar</Button><Button size="sm" onClick={() => createProfileMutation.mutate()} disabled={createProfileMutation.isPending || !profileName.trim()}>{createProfileMutation.isPending ? "Creando..." : "Crear"}</Button></div></CardContent></Card>
          ) : (<div className="flex justify-end"><Button size="sm" onClick={() => setShowCreateProfile(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Crear Perfil</Button></div>)}
          <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-[10px]">Nombre</TableHead><TableHead className="text-[10px]">Compartidos</TableHead><TableHead className="text-[10px]">Rate Limit</TableHead><TableHead className="text-[10px]">Sesión</TableHead><TableHead className="text-[10px]">Inactivo</TableHead><TableHead className="text-[10px] text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{loadingProfiles ? (<TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>) : profiles.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Sin perfiles</TableCell></TableRow>) : profiles.map((p: any) => (<TableRow key={p['.id']}><TableCell className="text-xs font-medium">{p.name}</TableCell><TableCell className="text-xs">{p['shared-users'] || '1'}</TableCell><TableCell className="text-xs">{p['rate-limit'] || 'Sin límite'}</TableCell><TableCell className="text-xs">{p['session-timeout'] || 'Sin límite'}</TableCell><TableCell className="text-xs">{p['idle-timeout'] || 'Sin límite'}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setDeleteProfileId(p['.id'])} disabled={p.name === 'default'}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></TableCell></TableRow>))}</TableBody></Table></div></CardContent></Card>
        </TabsContent>
        <TabsContent value="script" className="mt-3 space-y-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Code className="h-4 w-4 text-primary" /> Script On-Login (Omnisync)</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between"><Label className="text-xs font-medium">Script On-Login</Label><Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { copyToClipboard(onLoginScript).then(ok => ok ? toast.success("Script copiado") : toast.error("No se pudo copiar")); }}><Copy className="h-3 w-3 mr-1" /> Copiar</Button></div><Textarea readOnly value={onLoginScript} className="font-mono text-[10px] leading-relaxed h-[220px] bg-muted/50 resize-none" /></CardContent></Card>
        </TabsContent>
      </Tabs>
      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar perfil?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteProfileId && deleteProfileMutation.mutate(deleteProfileId)} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
