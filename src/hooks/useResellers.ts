import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ResellerAssignment {
  id: string;
  reseller_id: string;
  mikrotik_id: string;
  assigned_by: string;
  commission_percentage: number;
  created_at: string;
}

interface CreateResellerParams {
  email: string;
  password: string;
  fullName: string;
  mikrotikId: string;
  commissionPercentage?: number;
}

export const useResellers = (mikrotikId?: string) => {
  const queryClient = useQueryClient();

  // Fetch reseller assignments
  const { data: assignments, isLoading } = useQuery({
    queryKey: ['reseller-assignments', mikrotikId],
    queryFn: async () => {
      if (!mikrotikId) return [];
      
      const { data, error } = await supabase
        .from('reseller_assignments')
        .select(`
          *,
          reseller:profiles!reseller_assignments_reseller_id_fkey(*)
        `)
        .eq('mikrotik_id', mikrotikId);

      if (error) throw error;
      return data;
    },
    enabled: !!mikrotikId,
  });

  // Create reseller (signup + assign role + assign device)
  const createResellerMutation = useMutation({
    mutationFn: async (params: CreateResellerParams) => {
      // 1. Create user account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: params.email,
        password: params.password,
        options: {
          data: {
            full_name: params.fullName,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario');

      // 2. Assign reseller role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: authData.user.id,
          role: 'reseller',
        });

      if (roleError) throw roleError;

      // 3. Create reseller assignment
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado');

      const { error: assignmentError } = await supabase
        .from('reseller_assignments')
        .insert({
          reseller_id: authData.user.id,
          mikrotik_id: params.mikrotikId,
          assigned_by: user.id,
          commission_percentage: params.commissionPercentage || 0,
        });

      if (assignmentError) throw assignmentError;

      return authData.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Reseller creado exitosamente');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al crear reseller');
    },
  });

  // Update commission
  const updateCommissionMutation = useMutation({
    mutationFn: async (params: { assignmentId: string; commission: number }) => {
      const { error } = await supabase
        .from('reseller_assignments')
        .update({ commission_percentage: params.commission })
        .eq('id', params.assignmentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Comisión actualizada');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al actualizar comisión');
    },
  });

  // Remove reseller assignment
  const removeAssignmentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('reseller_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reseller-assignments'] });
      toast.success('Asignación eliminada');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al eliminar asignación');
    },
  });

  return {
    assignments,
    isLoading,
    createReseller: createResellerMutation.mutate,
    isCreating: createResellerMutation.isPending,
    updateCommission: updateCommissionMutation.mutate,
    isUpdating: updateCommissionMutation.isPending,
    removeAssignment: removeAssignmentMutation.mutate,
    isRemoving: removeAssignmentMutation.isPending,
  };
};
