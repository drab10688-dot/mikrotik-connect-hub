import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VoucherSaleRecord {
  id: string;
  voucher_code: string;
  voucher_password: string;
  profile: string;
  validity: string;
  price: number;
  mikrotik_id: string;
  created_by: string;
  sold_by: string | null;
  sold_at: string | null;
  activated_at: string | null;
  expired_at: string;
  total_uptime: string | null;
  created_at: string;
}

export const useVoucherSalesHistory = (mikrotikId?: string) => {
  const { data: salesHistory, isLoading } = useQuery({
    queryKey: ['voucher-sales-history', mikrotikId],
    queryFn: async () => {
      let query = supabase
        .from('voucher_sales_history')
        .select('*')
        .order('expired_at', { ascending: false });

      if (mikrotikId) {
        query = query.eq('mikrotik_id', mikrotikId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as VoucherSaleRecord[];
    },
    enabled: !!mikrotikId,
  });

  // Calculate stats for different periods
  const calculateStats = (records: VoucherSaleRecord[] | undefined) => {
    if (!records) return { today: 0, week: 0, month: 0, total: 0, revenue: 0 };
    
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return {
      today: records.filter(r => new Date(r.expired_at) >= startOfDay).length,
      week: records.filter(r => new Date(r.expired_at) >= startOfWeek).length,
      month: records.filter(r => new Date(r.expired_at) >= startOfMonth).length,
      total: records.length,
      revenue: records.reduce((sum, r) => sum + (r.price || 0), 0),
    };
  };

  return {
    salesHistory,
    isLoading,
    stats: calculateStats(salesHistory),
  };
};
