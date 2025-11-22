import { useQuery } from "@tanstack/react-query";
import { 
  getSystemInfo, 
  getHotspotUsers,
  getPPPoEUsers,
  getPPPoEActive,
  getVouchers,
} from "@/lib/mikrotik";

export const useSystemResources = () => {
  return useQuery({
    queryKey: ["system-resources"],
    queryFn: () => getSystemInfo("resources"),
    refetchInterval: 10000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useHotspotActiveUsers = () => {
  return useQuery({
    queryKey: ["hotspot-active"],
    queryFn: () => getSystemInfo("hotspot-active"),
    refetchInterval: 10000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useHotspotUsers = () => {
  return useQuery({
    queryKey: ["hotspot-users"],
    queryFn: () => getHotspotUsers(),
    refetchInterval: 15000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useInterfaces = () => {
  return useQuery({
    queryKey: ["interfaces"],
    queryFn: () => getSystemInfo("interfaces"),
    refetchInterval: 15000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPConnections = () => {
  return useQuery({
    queryKey: ["ppp-connections"],
    queryFn: () => getSystemInfo("ppp"),
    refetchInterval: 15000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPoEUsers = () => {
  return useQuery({
    queryKey: ["pppoe-users"],
    queryFn: () => getPPPoEUsers(),
    refetchInterval: 15000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPoEActive = () => {
  return useQuery({
    queryKey: ["pppoe-active"],
    queryFn: () => getPPPoEActive(),
    refetchInterval: 10000,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useVouchers = () => {
  return useQuery({
    queryKey: ["vouchers"],
    queryFn: () => getVouchers(),
    refetchInterval: 10000,
  });
};

export const useHotspotProfiles = () => {
  return useQuery({
    queryKey: ["hotspot-profiles"],
    queryFn: async () => {
      const { getHotspotProfiles } = await import("@/lib/mikrotik");
      return getHotspotProfiles();
    },
    refetchInterval: 30000,
  });
};

export const usePPPoEProfiles = () => {
  return useQuery({
    queryKey: ["pppoe-profiles"],
    queryFn: async () => {
      const { getPPPoEProfiles } = await import("@/lib/mikrotik");
      return getPPPoEProfiles();
    },
    refetchInterval: 30000,
  });
};
