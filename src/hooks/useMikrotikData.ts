import { useQuery } from "@tanstack/react-query";
import { getSystemInfo, getHotspotUsers } from "@/lib/mikrotik";

export const useSystemResources = () => {
  return useQuery({
    queryKey: ["system-resources"],
    queryFn: () => getSystemInfo("resources"),
    refetchInterval: 5000, // Actualizar cada 5 segundos
  });
};

export const useHotspotActiveUsers = () => {
  return useQuery({
    queryKey: ["hotspot-active"],
    queryFn: () => getSystemInfo("hotspot-active"),
    refetchInterval: 5000,
  });
};

export const useHotspotUsers = () => {
  return useQuery({
    queryKey: ["hotspot-users"],
    queryFn: () => getHotspotUsers(),
    refetchInterval: 10000,
  });
};

export const useInterfaces = () => {
  return useQuery({
    queryKey: ["interfaces"],
    queryFn: () => getSystemInfo("interfaces"),
    refetchInterval: 5000,
  });
};

export const usePPPConnections = () => {
  return useQuery({
    queryKey: ["ppp-connections"],
    queryFn: () => getSystemInfo("ppp"),
    refetchInterval: 5000,
  });
};
