import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { permissionsApi, api } from "@/lib/api-client";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";

type Perm = { section: string; can_view: boolean; can_edit: boolean };

interface Props {
  userId: string | null;
  userLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Permisos individuales: anulan la matriz del rol para ese usuario. */
export const UserPermissionsDialog = ({ userId, userLabel, open, onOpenChange }: Props) => {
  const [perms, setPerms] = useState<Perm[]>([]);

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

  useEffect(() => {
    if (!base?.sections) return;
    const overrides: Perm[] = userPerms?.permissions || [];
    setPerms(
      base.sections.map((section) => {
        const found = overrides.find((p) => p.section === section);
        return found ? { ...found } : { section, can_view: false, can_edit: false };
      })
    );
  }, [base, userPerms]);

  const labels = base?.labels || {};

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

  const save = useMutation({
    mutationFn: () => permissionsApi.saveForUser(userId!, perms),
    onSuccess: () => {
      toast.success("Permisos del usuario actualizados");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "No se pudieron guardar los permisos"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permisos de {userLabel || "usuario"}</DialogTitle>
          <DialogDescription>
            Estos permisos individuales tienen prioridad sobre los del rol dentro de este ISP.
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
                <p className="truncate text-sm font-medium">{labels[p.section] || p.section}</p>
                <p className="text-[11px] text-muted-foreground">{p.section}</p>
              </div>
              <div className="flex items-center gap-8">
                <div className="flex w-10 justify-center">
                  <Switch checked={p.can_view} onCheckedChange={(v) => toggle(p.section, "can_view", v)} />
                </div>
                <div className="flex w-10 justify-center">
                  <Switch checked={p.can_edit} onCheckedChange={(v) => toggle(p.section, "can_edit", v)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setPerms((prev) => prev.map((p) => ({ ...p, can_view: false, can_edit: false })))}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Quitar todo
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !userId}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Guardando…" : "Guardar permisos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
