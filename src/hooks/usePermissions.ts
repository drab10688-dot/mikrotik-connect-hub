import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "./useAuth";

export type SectionPerm = { section: string; can_view: boolean; can_edit: boolean };

type MyPermissions = {
  sections: string[];
  labels: Record<string, string>;
  permissions: SectionPerm[];
  full_access: boolean;
};

/**
 * Permisos efectivos del usuario dentro de su ISP.
 * Combina la matriz por rol del ISP con las anulaciones individuales.
 */
export const useMyPermissions = () => {
  const { user, isSuperAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["my-permissions", user?.id],
    queryFn: async () => (await api<{ data: MyPermissions }>("/isp/my-permissions")).data,
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const fullAccess = isSuperAdmin || data?.full_access !== false;

  const can = (section?: string, edit = false) => {
    if (!section) return true;
    if (fullAccess) return true;
    const perm = data?.permissions?.find((p) => p.section === section);
    if (!perm) return false;
    return edit ? !!perm.can_edit : !!perm.can_view;
  };

  return {
    permissions: data?.permissions || [],
    labels: data?.labels || {},
    sections: data?.sections || [],
    fullAccess,
    isLoading,
    can,
    canEdit: (section?: string) => can(section, true),
  };
};
