import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ServiceOption {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_default: boolean;
}

const DEFAULT_SERVICES: Omit<ServiceOption, "id">[] = [
  { name: "TV Incluido en el Plan", description: "Sin costo adicional", price: 0, is_default: true },
  { name: "+TV Adicional", description: "Agregar servicio de TV con costo adicional", price: 0, is_default: true },
  { name: "Solo TV", description: "Solo servicio de televisión sin internet", price: 0, is_default: true },
];

export function useServiceOptions(mikrotikId: string | null | undefined) {
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServices = useCallback(async () => {
    if (!mikrotikId) {
      setServices([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("service_options")
        .select("id, name, description, price, is_default")
        .eq("mikrotik_id", mikrotikId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setServices(data);
      } else {
        // Initialize with default services
        await initializeDefaultServices(mikrotikId);
      }
    } catch (error) {
      console.error("Error fetching services:", error);
      toast.error("Error al cargar servicios");
    } finally {
      setLoading(false);
    }
  }, [mikrotikId]);

  const initializeDefaultServices = async (deviceId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const servicesToInsert = DEFAULT_SERVICES.map(s => ({
        mikrotik_id: deviceId,
        created_by: user.id,
        name: s.name,
        description: s.description,
        price: s.price,
        is_default: s.is_default,
      }));

      const { data, error } = await supabase
        .from("service_options")
        .insert(servicesToInsert)
        .select("id, name, description, price, is_default");

      if (error) throw error;
      if (data) setServices(data);
    } catch (error) {
      console.error("Error initializing services:", error);
    }
  };

  const updateService = async (id: string, updates: Partial<Pick<ServiceOption, "price" | "description">>) => {
    try {
      const { error } = await supabase
        .from("service_options")
        .update(updates)
        .eq("id", id);

      if (error) throw error;

      setServices(prev => prev.map(s => 
        s.id === id ? { ...s, ...updates } : s
      ));
      
      return true;
    } catch (error) {
      console.error("Error updating service:", error);
      toast.error("Error al actualizar servicio");
      return false;
    }
  };

  const addService = async (name: string, description: string, price: number) => {
    if (!mikrotikId) return false;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data, error } = await supabase
        .from("service_options")
        .insert({
          mikrotik_id: mikrotikId,
          created_by: user.id,
          name,
          description,
          price,
          is_default: false,
        })
        .select("id, name, description, price, is_default")
        .single();

      if (error) {
        if (error.code === "23505") {
          toast.error("Ya existe un servicio con ese nombre");
          return false;
        }
        throw error;
      }

      if (data) {
        setServices(prev => [...prev, data]);
        toast.success("Servicio agregado");
      }
      return true;
    } catch (error) {
      console.error("Error adding service:", error);
      toast.error("Error al agregar servicio");
      return false;
    }
  };

  const deleteService = async (id: string) => {
    try {
      const { error } = await supabase
        .from("service_options")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setServices(prev => prev.filter(s => s.id !== id));
      toast.success("Servicio eliminado");
      return true;
    } catch (error) {
      console.error("Error deleting service:", error);
      toast.error("Error al eliminar servicio");
      return false;
    }
  };

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  return {
    services,
    loading,
    updateService,
    addService,
    deleteService,
    refetch: fetchServices,
  };
}

// Helper function to get service price by name (for use in forms)
export async function getServicePriceFromDB(mikrotikId: string, serviceName: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("service_options")
      .select("price")
      .eq("mikrotik_id", mikrotikId)
      .eq("name", serviceName)
      .single();

    if (error) return 0;
    return data?.price || 0;
  } catch {
    return 0;
  }
}
