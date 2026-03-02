import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Plus, Trash2, Wifi, Users, UserPlus, Search, RefreshCw, Copy, Code } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AddHotspotUserDialog } from "@/components/forms/AddHotspotUserDialog";

export function MonitorHotspot() {
  const selectedMikrotik = getSelectedDeviceId() || "";
  const [hotspotTab, setHotspotTab] = useState("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [, setShowAddUser] = useState(false);
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

  // Profiles
  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['hotspot-profiles-manage', selectedMikrotik],
    queryFn: async () => {
      if (!selectedMikrotik) return [];
      const { data, error } = await supabase.functions.invoke('mikrotik-v6-api', {
        body: { mikrotikId: selectedMikrotik, command: 'hotspot-profiles' },
      });
      if (error) throw error;
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
      const { error } = await supabase.functions.invoke('mikrotik-v6-api', {
        body: { mikrotikId: selectedMikrotik, command: 'hotspot-profile-add', params: profileData },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] });
      toast.success('Perfil creado');
      setShowCreateProfile(false);
      setProfileName(""); setSharedUsers("1"); setRateLimit(""); setSessionTimeout(""); setIdleTimeout("");
    },
    onError: (error: any) => toast.error(error.message || 'Error al crear perfil'),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase.functions.invoke('mikrotik-v6-api', {
        body: { mikrotikId: selectedMikrotik, command: 'hotspot-profile-delete', params: { '.id': profileId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotspot-profiles-manage'] });
      toast.success('Perfil eliminado');
      setDeleteProfileId(null);
    },
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

  const schedulerScript = `:local dateint do={:local montharray ( "jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec" );:local days [ :pick \$d 4 6 ];:local month [ :pick \$d 0 3 ];:local year [ :pick \$d 7 11 ];:local monthint ([ :find \$montharray \$month]);:local month (\$monthint + 1);:if ( [len \$month] = 1) do={:local zero ("0");:return [:tonum ("\$year\$zero\$month\$days")];} else={:return [:tonum ("\$year\$month\$days")];}};
:local timeint do={ :local hours [ :pick \$t 0 2 ]; :local minutes [ :pick \$t 3 5 ]; :return (\$hours * 60 + \$minutes) ; };
:local date [ /system clock get date ];
:local time [ /system clock get time ];
:local today [\$dateint d=\$date] ;
:local curtime [\$timeint t=\$time] ;
:foreach i in [ /ip hotspot user find where profile="3_Dias" ] do={
  :local comment [ /ip hotspot user get \$i comment];
  :local name [ /ip hotspot user get \$i name];
  :local gettime [:pic \$comment 12 20];
  :if ([:pic \$comment 3] = "/" and [:pic \$comment 6] = "/") do={
    :local expd [\$dateint d=\$comment] ;
    :local expt [\$timeint t=\$gettime] ;
    :if ((\$expd < \$today and \$expt < \$curtime) or (\$expd < \$today and \$expt > \$curtime) or (\$expd = \$today and \$expt < \$curtime)) do={
      [ /ip hotspot user remove \$i ];
      [ /ip hotspot active remove [find where user=\$name] ];
    }
  }
}`;

  const filteredActive = hotspotActive.filter((u: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (u.user || u.name || "").toLowerCase().includes(term) || (u.address || "").includes(term);
  });

  const filteredUsers = hotspotUsers.filter((u: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (u.name || "").toLowerCase().includes(term);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Gestión Hotspot</h2>
        </div>
        <AddHotspotUserDialog onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hotspot-users'] })} />
      </div>

      <div className="relative md:w-64">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" />
      </div>

      <Tabs value={hotspotTab} onValueChange={setHotspotTab}>
        <TabsList className="h-8">
          <TabsTrigger value="active" className="text-xs">Activos ({hotspotActive.length})</TabsTrigger>
          <TabsTrigger value="users" className="text-xs">Usuarios ({hotspotUsers.length})</TabsTrigger>
          <TabsTrigger value="profiles" className="text-xs">Perfiles ({profiles.length})</TabsTrigger>
          <TabsTrigger value="script" className="text-xs">Script</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Usuario</TableHead>
                      <TableHead className="text-[10px]">IP</TableHead>
                      <TableHead className="text-[10px]">MAC</TableHead>
                      <TableHead className="text-[10px]">Perfil</TableHead>
                      <TableHead className="text-[10px]">Uptime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActive.length > 0 ? filteredActive.map((u: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{u.user || u.name || "-"}</TableCell>
                        <TableCell className="text-[10px] font-mono">{u.address || "-"}</TableCell>
                        <TableCell className="text-[10px] font-mono text-muted-foreground">{u["mac-address"] || "-"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{u.uptime || "0s"}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios activos</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Nombre</TableHead>
                      <TableHead className="text-[10px]">Perfil</TableHead>
                      <TableHead className="text-[10px]">Comentario</TableHead>
                      <TableHead className="text-[10px]">Disabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.length > 0 ? filteredUsers.map((u: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{u.name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px]">{u.profile || "default"}</Badge></TableCell>
                        <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{u.comment || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={u.disabled === "true" ? "destructive" : "default"} className="text-[9px]">
                            {u.disabled === "true" ? "Sí" : "No"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs">Sin usuarios</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profiles" className="mt-3 space-y-3">
          {showCreateProfile ? (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Crear Perfil</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="5mbps-1hora" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Usuarios Compartidos</Label>
                    <Input type="number" value={sharedUsers} onChange={(e) => setSharedUsers(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate Limit</Label>
                    <Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="5M/5M" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Session Timeout</Label>
                    <Input value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} placeholder="1h" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Idle Timeout</Label>
                    <Input value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} placeholder="5m" className="h-8 text-xs" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setShowCreateProfile(false)}>Cancelar</Button>
                  <Button size="sm" onClick={() => createProfileMutation.mutate()} disabled={createProfileMutation.isPending || !profileName.trim()}>
                    {createProfileMutation.isPending ? "Creando..." : "Crear"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowCreateProfile(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Crear Perfil</Button>
            </div>
          )}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Nombre</TableHead>
                      <TableHead className="text-[10px]">Compartidos</TableHead>
                      <TableHead className="text-[10px]">Rate Limit</TableHead>
                      <TableHead className="text-[10px]">Sesión</TableHead>
                      <TableHead className="text-[10px]">Inactivo</TableHead>
                      <TableHead className="text-[10px] text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingProfiles ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Cargando...</TableCell></TableRow>
                    ) : profiles.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-muted-foreground">Sin perfiles</TableCell></TableRow>
                    ) : profiles.map((p: any) => (
                      <TableRow key={p['.id']}>
                        <TableCell className="text-xs font-medium">{p.name}</TableCell>
                        <TableCell className="text-xs">{p['shared-users'] || '1'}</TableCell>
                        <TableCell className="text-xs">{p['rate-limit'] || 'Sin límite'}</TableCell>
                        <TableCell className="text-xs">{p['session-timeout'] || 'Sin límite'}</TableCell>
                        <TableCell className="text-xs">{p['idle-timeout'] || 'Sin límite'}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setDeleteProfileId(p['.id'])} disabled={p.name === 'default'}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="script" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Code className="h-4 w-4 text-primary" /> Script On-Login (Omnisync)</CardTitle>
              <CardDescription className="text-[10px]">
                Coloca este script en el campo "On Login" de cada perfil hotspot para controlar la expiración automática por tiempo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Script On-Login (3 días, 5Mbps)</Label>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => {
                    navigator.clipboard.writeText(onLoginScript);
                    toast.success("Script copiado al portapapeles");
                  }}>
                    <Copy className="h-3 w-3 mr-1" /> Copiar
                  </Button>
                </div>
                <Textarea readOnly value={onLoginScript} className="font-mono text-[10px] leading-relaxed h-[220px] bg-muted/50 resize-none" />
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
                <p className="text-[10px] font-medium text-primary">📋 Instrucciones On-Login:</p>
                <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                  <li>Copia el script de arriba</li>
                  <li>Ve a tu MikroTik → IP → Hotspot → User Profiles</li>
                  <li>Selecciona el perfil deseado</li>
                  <li>Pega el script en el campo <code className="bg-muted px-1 rounded">On Login</code></li>
                  <li>Modifica <code className="bg-muted px-1 rounded">interval="3d"</code> según la validez deseada</li>
                  <li>Ajusta la velocidad en <code className="bg-muted px-1 rounded">remc,5000,3d,5000</code></li>
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Code className="h-4 w-4 text-primary" /> Script Scheduler (Expiración)</CardTitle>
              <CardDescription className="text-[10px]">
                Este script se coloca en System → Scheduler para eliminar automáticamente usuarios expirados del hotspot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Script Scheduler (perfil: 3_Dias)</Label>
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => {
                    navigator.clipboard.writeText(schedulerScript);
                    toast.success("Script copiado al portapapeles");
                  }}>
                    <Copy className="h-3 w-3 mr-1" /> Copiar
                  </Button>
                </div>
                <Textarea readOnly value={schedulerScript} className="font-mono text-[10px] leading-relaxed h-[220px] bg-muted/50 resize-none" />
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
                <p className="text-[10px] font-medium text-primary">📋 Instrucciones Scheduler:</p>
                <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                  <li>Copia el script de arriba</li>
                  <li>Ve a tu MikroTik → System → Scheduler</li>
                  <li>Crea una nueva tarea con intervalo <code className="bg-muted px-1 rounded">00:01:00</code> (cada minuto)</li>
                  <li>Pega el script en el campo <code className="bg-muted px-1 rounded">On Event</code></li>
                  <li>Cambia <code className="bg-muted px-1 rounded">profile="3_Dias"</code> al nombre de tu perfil</li>
                  <li>Este script revisa y elimina usuarios cuyo tiempo de expiración ya pasó</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      

      <AlertDialog open={!!deleteProfileId} onOpenChange={() => setDeleteProfileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar perfil?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteProfileId && deleteProfileMutation.mutate(deleteProfileId)} className="bg-destructive hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
