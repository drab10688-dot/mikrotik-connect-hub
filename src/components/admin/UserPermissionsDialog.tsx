import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { permissionsApi, api } from "@/lib/api-client";
import { toast } from "sonner";
import { RotateCcw, Save, Lock } from "lucide-react";

type Perm = { section: string; can_view: boolean; can_edit: boolean };

interface Props {
  userId: string | null;
  userLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  user: "Operador",
  secretary: "Secretaría",
  reseller: "Reseller",
};

/** Secciones que el administrador del ISP nunca pierde (evita auto-bloqueo). */
const ADMIN_LOCKED = ["dashboard", "usuarios", "roles"];

/** Permisos individuales: parten del rol y lo anulan solo para ese usuario. */
export const UserPermissionsDialog = ({ userId, userLabel, open, onOpenChange }: Props) => {
  const [perms, setPerms] = useState<Perm[]>([]);
  const queryClient = useQueryClient();

  const { data: base } = useQuery({
    queryKey: ["isp-sections"],
    queryFn: async () =>
      (await api<{ data: { sections: string[]; labels?: Record<string, string> } }>("/isp/permissions")).data,
    enabled: open,
  });

  const { data: userPerms } = useQuery({
    queryKey: ["user-permissions", userId],
    queryFn: () => permissionsApi.forUser(userId!),
    enabled: open && !!userId,
  });

  const role: string = userPerms?.role || "user";
  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!base?.sections) return;
    const overrides: Perm[] = userPerms?.permissions || [];
    const roleBase: Perm[] = userPerms?.role_permissions || [];
    setPerms(
      base.sections.map((section) => {
        const own = overrides.find((p) => p.section === section);
        if (own) return { ...own };
        const inherited = roleBase.find((p) => p.section === section);
        return inherited
          ? { section, can_view: !!inherited.can_view, can_edit: !!inherited.can_edit }
          : { section, can_view: false, can_edit: false };
      })
    );
  }, [base, userPerms]);

  const labels = base?.labels || {};
  const locked = (section: string) => isSuperAdmin || (isAdmin && ADMIN_LOCKED.includes(section));

  const toggle = (section: string, key: "can_view" | "can_edit", value: boolean) =>
    setPerms((prev) =>
      prev.map((p) =>
        p.section === section
          ? {
              ...p,
              [key]: value,
              ...(key === "can_edit" && value ? { can_view: true } : {}),
              ...(key === "can_view" && !value ? { can_edit: false } : {}),
            }
          : p
      )
    );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["user-permissions", userId] });
    queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
  };

  const save = useMutation({
    mutationFn: () =>
      permissionsApi.saveForUser(
        userId!,
        // El admin nunca queda sin la administración de su propio ISP
        perms.map((p) => (locked(p.section) ? { ...p, can_view: true, can_edit: true } : p))
      ),
    onSuccess: () => {
      toast.success("Permisos del usuario actualizados");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar los permisos"),
  });

  const reset = useMutation({
    mutationFn: () => permissionsApi.resetForUser(userId!),
    onSuccess: () => {
      toast.success("El usuario vuelve a heredar los permisos de su rol");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "No se pudo restablecer"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Permisos de {userLabel || "usuario"}
            <Badge variant="secondary">{ROLE_LABELS[role] || role}</Badge>
          </DialogTitle>
          <DialogDescription>
            {isSuperAdmin
              ? "Los super administradores tienen acceso total y no se pueden limitar."
              : userPerms?.has_overrides
              ? "Este usuario tiene permisos individuales que anulan los de su rol."
              : "Mostrando los permisos heredados del rol. Al guardar se crearán permisos individuales para este usuario."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/50">
          <div className="flex items-center justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Sección</span>
            <span className="flex gap-8">
              <span className="w-10 text-center">Ver</span>
              <span className="w-10 text-center">Editar</span>
            </span>
          </div>
          {perms.map((p) => (
            <div key={p.section} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium flex items-center gap-1.5">
                  {labels[p.section] || p.section}
                  {locked(p.section) && <Lock className="h-3 w-3 text-muted-foreground" />}
                </p>
                <p className="text-[11px] text-muted-foreground">{p.section}</p>
              </div>
              <div className="flex items-center gap-8">
                <div className="flex w-10 justify-center">
                  <Switch
                    checked={locked(p.section) ? true : p.can_view}
                    disabled={locked(p.section)}
                    onCheckedChange={(v) => toggle(p.section, "can_view", v)}
                  />
                </div>
                <div className="flex w-10 justify-center">
                  <Switch
                    checked={locked(p.section) ? true : p.can_edit}
                    disabled={locked(p.section)}
                    onCheckedChange={(v) => toggle(p.section, "can_edit", v)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => reset.mutate()}
            disabled={reset.isPending || !userId || isSuperAdmin}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {reset.isPending ? "Restableciendo…" : "Heredar del rol"}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !userId || isSuperAdmin}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Guardando…" : "Guardar permisos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
