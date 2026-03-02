import { useState, useEffect, useCallback } from "react";
import { serviceOptionsApi } from "@/lib/api-client";
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
      const data = await serviceOptionsApi.list(mikrotikId);

      if (data && data.length > 0) {
        setServices(data);
      } else {
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
      for (const s of DEFAULT_SERVICES) {
        await serviceOptionsApi.create({
          mikrotik_id: deviceId,
          name: s.name,
          description: s.description,
          price: s.price,
          is_default: s.is_default,
        });
      }
      // Refetch after creation
      const data = await serviceOptionsApi.list(deviceId);
      if (data) setServices(data);
    } catch (error) {
      console.error("Error initializing services:", error);
    }
  };

  const updateService = async (id: string, updates: Partial<Pick<ServiceOption, "price" | "description">>) => {
    try {
      await serviceOptionsApi.update(id, updates);
      setServices(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
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
      const data = await serviceOptionsApi.create({
        mikrotik_id: mikrotikId,
        name,
        description,
        price,
        is_default: false,
      });

      if (data) {
        setServices(prev => [...prev, data]);
        toast.success("Servicio agregado");
      }
      return true;
    } catch (error: any) {
      if (error.message?.includes('duplicate') || error.status === 409) {
        toast.error("Ya existe un servicio con ese nombre");
      } else {
        toast.error("Error al agregar servicio");
      }
      return false;
    }
  };

  const deleteService = async (id: string) => {
    try {
      await serviceOptionsApi.delete(id);
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

export async function getServicePriceFromDB(mikrotikId: string, serviceName: string): Promise<number> {
  try {
    const services = await serviceOptionsApi.list(mikrotikId);
    const service = services?.find((s: any) => s.name === serviceName);
    return service?.price || 0;
  } catch {
    return 0;
  }
}
