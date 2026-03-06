import { useQuery } from "@tanstack/react-query";
import {
  getSelectedDeviceId,
  getSystemInfo,
  getHotspotUsers,
  getPPPoEUsers,
  getPPPoEActive,
  getVouchers,
} from "@/lib/mikrotik";

const useMikrotikDeviceId = () => getSelectedDeviceId();

export const useSystemResources = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["system-resources", mikrotikId],
    queryFn: () => getSystemInfo("resources"),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 10000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useHotspotActiveUsers = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["hotspot-active", mikrotikId],
    queryFn: () => getSystemInfo("hotspot-active"),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 10000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useHotspotUsers = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["hotspot-users", mikrotikId],
    queryFn: () => getHotspotUsers(),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 15000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useInterfaces = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["interfaces", mikrotikId],
    queryFn: () => getSystemInfo("interfaces"),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 15000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPConnections = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["ppp-connections", mikrotikId],
    queryFn: () => getSystemInfo("ppp"),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 15000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPoEUsers = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["pppoe-users", mikrotikId],
    queryFn: () => getPPPoEUsers(),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 15000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const usePPPoEActive = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["pppoe-active", mikrotikId],
    queryFn: () => getPPPoEActive(),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 10000 : false,
    retry: 2,
    retryDelay: 1000,
  });
};

export const useVouchers = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["vouchers", mikrotikId],
    queryFn: () => getVouchers(),
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 10000 : false,
  });
};

export const useHotspotProfiles = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["hotspot-profiles", mikrotikId],
    queryFn: async () => {
      const { getHotspotProfiles } = await import("@/lib/mikrotik");
      return getHotspotProfiles();
    },
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 30000 : false,
  });
};

export const usePPPoEProfiles = () => {
  const mikrotikId = useMikrotikDeviceId();
  return useQuery({
    queryKey: ["pppoe-profiles", mikrotikId],
    queryFn: async () => {
      const { getPPPoEProfiles } = await import("@/lib/mikrotik");
      return getPPPoEProfiles();
    },
    enabled: !!mikrotikId,
    refetchInterval: mikrotikId ? 30000 : false,
  });
};
