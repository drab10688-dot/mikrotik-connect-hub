import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

type Perm = { role: string; section: string; can_view: boolean; can_edit: boolean };

const ROLES = ["admin", "user", "secretary", "reseller"];
const LABELS: Record<string, string> = {
  onus: "ONUs",
  wifi: "WiFi",
  pppoe: "PPPoE",
  red: "Red",
  firmware: "Firmware",
  vpn: "VPN",
  usuarios: "Usuarios",
};

const Permissions = () => {
  const [sections, setSections] = useState<string[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);

  const { data } = useQuery({
    queryKey: ["isp-permissions"],
    queryFn: async () =>
      (await api<{ data: { sections: string[]; permissions: Perm[] } }>("/isp/permissions")).data,
  });

  useEffect(() => {
    if (!data) return;
    setSections(data.sections);
    const full: Perm[] = [];
    for (const role of ROLES) {
      for (const section of data.sections) {
        const found = data.permissions.find((p) => p.role === role && p.section === section);
        full.push(found || { role, section, can_view: false, can_edit: false });
      }
    }
    setPerms(full);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api("/isp/permissions", { method: "PUT", body: { permissions: perms } }),
    onSuccess: () => toast.success("Permisos guardados"),
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (role: string, section: string, key: "can_view" | "can_edit", value: boolean) =>
    setPerms((prev) =>
      prev.map((p) =>
        p.role === role && p.section === section
          ? { ...p, [key]: value, ...(key === "can_edit" && value ? { can_view: true } : {}) }
          : p
      )
    );

  const get = (role: string, section: string) =>
    perms.find((p) => p.role === role && p.section === section) || { can_view: false, can_edit: false };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto p-4 md:p-6 md:ml-64 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-primary" />
            Permisos por rol
          </h1>
          <p className="text-sm text-muted-foreground">
            Define qué puede ver y editar cada rol dentro del panel.
          </p>
        </header>

        {ROLES.map((role) => (
          <Card key={role}>
            <CardHeader>
              <CardTitle className="capitalize">{role}</CardTitle>
              <CardDescription>Secciones disponibles para este rol</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sección</TableHead>
                    <TableHead className="w-24 text-center">Ver</TableHead>
                    <TableHead className="w-24 text-center">Editar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map((section) => {
                    const perm = get(role, section);
                    return (
                      <TableRow key={section}>
                        <TableCell>{LABELS[section] || section}</TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_view}
                            onCheckedChange={(v) => toggle(role, section, "can_view", !!v)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={perm.can_edit}
                            onCheckedChange={(v) => toggle(role, section, "can_edit", !!v)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar permisos"}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Permissions;
