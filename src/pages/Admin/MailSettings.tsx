import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mailApi } from "@/lib/api-client";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Mail, Send, Loader2, Globe } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type Scope = "tenant" | "global";

const emptyForm = {
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  from_email: "",
  from_name: "",
  domain: "",
  is_active: true,
};

/** Servidor de correo (SMTP) usado para restablecer contraseñas y avisos. */
export default function MailSettings() {
  const { isSuperAdmin, user } = useAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>(isSuperAdmin ? "global" : "tenant");
  const [form, setForm] = useState(emptyForm);
  const [testTo, setTestTo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["mail-settings", scope],
    queryFn: () => mailApi.getSettings(scope),
  });

  useEffect(() => {
    setForm({
      host: data?.host || "",
      port: String(data?.port ?? 587),
      secure: !!data?.secure,
      username: data?.username || "",
      password: "",
      from_email: data?.from_email || "",
      from_name: data?.from_name || "",
      domain: data?.domain || "",
      is_active: data?.is_active !== false,
    });
  }, [data]);

  useEffect(() => { if (user?.email && !testTo) setTestTo(user.email); }, [user?.email]);

  const save = useMutation({
    mutationFn: () =>
      mailApi.saveSettings(
        {
          host: form.host,
          port: Number(form.port) || 587,
          secure: form.secure,
          username: form.username || null,
          password: form.password || undefined,
          from_email: form.from_email,
          from_name: form.from_name || null,
          domain: form.domain || null,
          is_active: form.is_active,
        },
        scope,
      ),
    onSuccess: () => {
      toast.success("Configuración de correo guardada");
      queryClient.invalidateQueries({ queryKey: ["mail-settings", scope] });
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo guardar"),
  });

  const test = useMutation({
    mutationFn: () => mailApi.test(testTo, scope),
    onSuccess: () => toast.success(`Correo de prueba enviado a ${testTo}`),
    onError: (e: any) => toast.error(e?.message || "No se pudo enviar el correo"),
  });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8 md:ml-64">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">Correo (SMTP)</h1>
              <p className="text-muted-foreground">
                Necesario para enviar los enlaces de restablecimiento de contraseña
              </p>
            </div>
            {data?.has_password && <Badge variant="secondary">Credenciales guardadas</Badge>}
          </div>

          {isSuperAdmin && (
            <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <TabsList>
                <TabsTrigger value="global">Sistema (global)</TabsTrigger>
                <TabsTrigger value="tenant">Mi ISP</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><Mail className="h-6 w-6 text-primary" /></div>
                <div>
                  <CardTitle>Servidor de salida</CardTitle>
                  <CardDescription>
                    {scope === "global"
                      ? "Se usa cuando un ISP no tiene su propio servidor configurado"
                      : "Correos enviados con el dominio de este ISP"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="py-8 text-center text-muted-foreground">Cargando…</div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Servidor SMTP</Label>
                      <Input placeholder="smtp.tudominio.com" value={form.host}
                        onChange={(e) => setForm({ ...form, host: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Puerto</Label>
                      <Input inputMode="numeric" value={form.port}
                        onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, "") })} />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Usuario</Label>
                      <Input autoComplete="off" value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Contraseña</Label>
                      <Input type="password" autoComplete="new-password"
                        placeholder={data?.has_password ? "•••••••• (sin cambios)" : ""}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Correo remitente</Label>
                      <Input placeholder="soporte@tudominio.com" value={form.from_email}
                        onChange={(e) => setForm({ ...form, from_email: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre remitente</Label>
                      <Input placeholder="Soporte OmniSync" value={form.from_name}
                        onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Globe className="h-4 w-4" />Dominio del panel</Label>
                    <Input placeholder="panel.tudominio.com" value={form.domain}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })} />
                    <p className="text-xs text-muted-foreground">
                      Se usa para armar el enlace de restablecimiento del correo.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-6 pt-2">
                    <div className="flex items-center gap-3">
                      <Switch checked={form.secure} onCheckedChange={(v) => setForm({ ...form, secure: v })} />
                      <span className="text-sm">Conexión SSL/TLS directa (puerto 465)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                      <span className="text-sm">Activo</span>
                    </div>
                  </div>

                  <Button onClick={() => save.mutate()} disabled={save.isPending || !form.host || !form.from_email}>
                    {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar configuración
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Probar envío</CardTitle>
              <CardDescription>Envía un correo de verificación con esta configuración</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Input placeholder="destino@correo.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !testTo}>
                {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar prueba
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
