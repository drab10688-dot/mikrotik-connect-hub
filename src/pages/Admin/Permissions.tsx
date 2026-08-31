import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { KeyRound, Eye, Pencil, ShieldCheck, RotateCcw, Save } from "lucide-react";

type Perm = { role: string; section: string; can_view: boolean; can_edit: boolean };

const ROLES: { id: string; label: string; desc: string }[] = [
  { id: "admin", label: "Administrador", desc: "Control total del ISP" },
  { id: "user", label: "Operador", desc: "Operación diaria de red y ONUs" },
  { id: "secretary", label: "Asistente", desc: "Atención al cliente y soporte básico" },
  { id: "reseller", label: "Reseller", desc: "Solo consulta de su cartera" },
];

const FALLBACK_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  onus: "Gestión de ONUs",
  onu_web: "Mini-panel de equipos",
  mikrotik: "Conexión MikroTik",
  pppoe: "Usuarios PPPoE",
  topology: "Mapa de red",
  red: "Red, APs y señal",
  vpn: "Credenciales y VPN",
  configuracion: "Configuración",
  diagnostico: "Diagnóstico API",
  usuarios: "Usuarios",
  roles: "Roles y permisos",
};

const GROUPS: { title: string; sections: string[] }[] = [
  { title: "Operación", sections: ["dashboard", "onus", "onu_web", "mikrotik", "pppoe", "topology", "red"] },
  { title: "Infraestructura", sections: ["vpn", "configuracion", "diagnostico"] },
  { title: "Administración", sections: ["usuarios", "roles"] },
];

const Permissions = () => {
  const [sections, setSections] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>(FALLBACK_LABELS);
  const [perms, setPerms] = useState<Perm[]>([]);

  const { data } = useQuery({
    queryKey: ["isp-permissions"],
    queryFn: async () =>
      (
        await api<{ data: { sections: string[]; labels?: Record<string, string>; permissions: Perm[] } }>(
          "/isp/permissions"
        )
      ).data,
  });

  useEffect(() => {
    if (!data) return;
    setSections(data.sections);
    if (data.labels) setLabels({ ...FALLBACK_LABELS, ...data.labels });
    const full: Perm[] = [];
    for (const role of ROLES) {
      for (const section of data.sections) {
        const found = data.permissions.find((p) => p.role === role.id && p.section === section);
        full.push(found || { role: role.id, section, can_view: false, can_edit: false });
      }
    }
    setPerms(full);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api("/isp/permissions", { method: "PUT", body: { permissions: perms } }),
    onSuccess: () => toast.success("Permisos actualizados para este ISP"),
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (role: string, section: string, key: "can_view" | "can_edit", value: boolean) =>
    setPerms((prev) =>
      prev.map((p) =>
        p.role === role && p.section === section
          ? {
              ...p,
              [key]: value,
              ...(key === "can_edit" && value ? { can_view: true } : {}),
              ...(key === "can_view" && !value ? { can_edit: false } : {}),
            }
          : p
      )
    );

  const setAll = (role: string, value: boolean) =>
    setPerms((prev) =>
      prev.map((p) => (p.role === role ? { ...p, can_view: value, can_edit: value } : p))
    );

  const get = (role: string, section: string) =>
    perms.find((p) => p.role === role && p.section === section) || { can_view: false, can_edit: false };

  const grouped = useMemo(() => {
    const known = new Set(GROUPS.flatMap((g) => g.sections));
    const extras = sections.filter((s) => !known.has(s));
    return [
      ...GROUPS.map((g) => ({ ...g, sections: g.sections.filter((s) => sections.includes(s)) })),
      ...(extras.length ? [{ title: "Otros", sections: extras }] : []),
    ].filter((g) => g.sections.length);
  }, [sections]);

  const countFor = (role: string) => perms.filter((p) => p.role === role && p.can_view).length;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="relative flex-1 min-w-0 overflow-auto p-4 md:p-8 md:ml-64 space-y-6">
        <header className="glass-panel hairline-top flex flex-wrap items-center justify-between gap-4 p-5 animate-fade-in-up">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">Roles y permisos del ISP</h1>
              <p className="text-sm text-muted-foreground">
                Define qué puede ver y editar cada rol. Se aplica a todos los usuarios de este ISP.
              </p>
            </div>
          </div>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="bg-gradient-primary text-primary-foreground shadow-primary hover:opacity-95"
          >
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </header>

        <Tabs defaultValue={ROLES[0].id} className="space-y-5">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-card/60 p-1.5 backdrop-blur">
            {ROLES.map((r) => (
              <TabsTrigger
                key={r.id}
                value={r.id}
                className="gap-2 data-[state=active]:bg-primary/15 data-[state=active]:text-primary"
              >
                <ShieldCheck className="h-4 w-4" />
                {r.label}
                <Badge variant="secondary" className="ml-1 tabular-nums">
                  {countFor(r.id)}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {ROLES.map((role) => (
            <TabsContent key={role.id} value={role.id} className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{role.desc}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAll(role.id, true)}>
                    Todo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAll(role.id, false)}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Nada
                  </Button>
                </div>
              </div>

              {grouped.map((group) => (
                <section key={group.title} className="glass-panel overflow-hidden animate-fade-in-up">
                  <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {group.title}
                    </h2>
                    <div className="hidden gap-8 pr-1 text-[11px] uppercase tracking-wider text-muted-foreground sm:flex">
                      <span className="w-10 text-center">Ver</span>
                      <span className="w-10 text-center">Editar</span>
                    </div>
                  </div>
                  <ul className="divide-y divide-border/50">
                    {group.sections.map((section) => {
                      const perm = get(role.id, section);
                      return (
                        <li
                          key={section}
                          className="flex items-center justify-between gap-4 px-5 py-3 transition-smooth hover:bg-primary/[0.04]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{labels[section] || section}</p>
                            <p className="text-[11px] text-muted-foreground">{section}</p>
                          </div>
                          <div className="flex items-center gap-8">
                            <div className="flex w-10 justify-center" title="Ver">
                              <Switch
                                checked={perm.can_view}
                                onCheckedChange={(v) => toggle(role.id, section, "can_view", v)}
                                aria-label={`Ver ${section}`}
                              />
                            </div>
                            <div className="flex w-10 justify-center" title="Editar">
                              <Switch
                                checked={perm.can_edit}
                                onCheckedChange={(v) => toggle(role.id, section, "can_edit", v)}
                                aria-label={`Editar ${section}`}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
          <span className="flex items-center gap-2">
            <Eye className="h-3.5 w-3.5" /> Ver = acceso de lectura
            <span className="mx-2 opacity-40">|</span>
            <Pencil className="h-3.5 w-3.5" /> Editar = puede aplicar cambios
          </span>
          <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm">
            {save.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Permissions;
