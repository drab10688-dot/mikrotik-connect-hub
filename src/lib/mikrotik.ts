import { systemApi, hotspotApi, pppoeApi, vouchersApi } from "@/lib/api-client";

export interface MikroTikDeviceConfig {
  id: string;
  name: string;
  host: string;
  port: string | number;
  version: string;
}

export const saveSelectedDevice = (device: MikroTikDeviceConfig) => {
  localStorage.setItem("mikrotik_device_id", device.id);
  localStorage.setItem("mikrotik_connected", "true");
  localStorage.setItem("mikrotik_host", device.host);
  localStorage.setItem("mikrotik_version", device.version);
  localStorage.setItem("mikrotik_device_name", device.name);
  localStorage.setItem("mikrotik_port", String(device.port));
};

export const getSelectedDevice = (): MikroTikDeviceConfig | null => {
  const id = localStorage.getItem("mikrotik_device_id");
  if (!id) return null;
  return {
    id,
    name: localStorage.getItem("mikrotik_device_name") || "",
    host: localStorage.getItem("mikrotik_host") || "",
    port: localStorage.getItem("mikrotik_port") || "8728",
    version: localStorage.getItem("mikrotik_version") || "v6",
  };
};

export const getSelectedDeviceId = (): string | null => {
  return localStorage.getItem("mikrotik_device_id");
};

export const clearSelectedDevice = () => {
  localStorage.removeItem("mikrotik_device_id");
  localStorage.removeItem("mikrotik_connected");
  localStorage.removeItem("mikrotik_host");
  localStorage.removeItem("mikrotik_version");
  localStorage.removeItem("mikrotik_device_name");
  localStorage.removeItem("mikrotik_port");
  localStorage.removeItem("mikrotik_config");
};

export const cleanupLegacyStorage = () => {
  const legacyConfig = localStorage.getItem("mikrotik_config");
  if (legacyConfig) {
    localStorage.removeItem("mikrotik_config");
  }
};

// ─── MikroTik Functions via VPS API ─────────────────────

const getDeviceId = (): string => {
  const id = getSelectedDeviceId();
  if (!id) throw new Error("No hay dispositivo MikroTik seleccionado");
  return id;
};

export const callMikroTikFunction = async (
  functionName: string,
  params: Record<string, any>
) => {
  const mikrotikId = getDeviceId();
  const { apiPost } = await import("@/lib/api-client");
  const response = await apiPost(`/system/mikrotik/command`, {
    mikrotik_id: mikrotikId,
    command: functionName,
    params,
  });
  return (response as any)?.data ?? response;
};

export const testMikroTikConnection = async (mikrotikId: string, _version: string) => {
  return await systemApi.testConnection(mikrotikId);
};

export const getSystemInfo = async (type: string = "resources") => {
  const mikrotikId = getDeviceId();
  if (type === "resources") {
    const data = await systemApi.resources(mikrotikId);
    return Array.isArray(data) ? data : [data];
  }
  if (type === "interfaces") {
    return await systemApi.interfaces(mikrotikId);
  }
  if (type === "hotspot-active") {
    return await hotspotApi.activeUsers(mikrotikId);
  }
  if (type === "ppp") {
    return await pppoeApi.active(mikrotikId);
  }
  // Fallback: generic command
  const { apiPost } = await import("@/lib/api-client");
  const response = await apiPost(`/system/mikrotik/command`, { mikrotik_id: mikrotikId, command: type });
  return (response as any)?.data ?? response;
};

export const getHotspotUsers = async () => {
  return await hotspotApi.users(getDeviceId());
};

export const addHotspotUser = async (userData: {
  name: string;
  password: string;
  profile?: string;
  limit?: string;
}) => {
  return await hotspotApi.addUser(getDeviceId(), userData);
};

export const removeHotspotUser = async (userId: string) => {
  return await hotspotApi.removeUser(getDeviceId(), userId);
};

export const getPPPoEUsers = async () => {
  return await pppoeApi.list(getDeviceId());
};

export const addPPPoEUser = async (userData: {
  name: string;
  password: string;
  service?: string;
  profile?: string;
  localAddress?: string;
  remoteAddress?: string;
  comment?: string;
}) => {
  return await pppoeApi.add(getDeviceId(), userData);
};

export const removePPPoEUser = async (userId: string) => {
  return await pppoeApi.remove(getDeviceId(), userId);
};

export const togglePPPoEUser = async (userId: string, currentlyDisabled: boolean) => {
  const mikrotikId = getDeviceId();
  return currentlyDisabled
    ? await pppoeApi.enable(mikrotikId, userId)
    : await pppoeApi.disable(mikrotikId, userId);
};

export const disconnectPPPoEUser = async (connectionId: string) => {
  return await pppoeApi.disconnect(getDeviceId(), connectionId);
};

export const getPPPoEActive = async () => {
  return await pppoeApi.active(getDeviceId());
};

export const generateVouchers = async (count: number, profile?: string) => {
  return await vouchersApi.generate(getDeviceId(), { count, profile });
};

export const getVouchers = async () => {
  return await vouchersApi.list(getDeviceId());
};

export const deleteVoucher = async (voucherId: string) => {
  return await vouchersApi.delete(getDeviceId(), voucherId);
};

// Profiles Management
export const getHotspotProfiles = async () => {
  return await hotspotApi.profiles(getDeviceId());
};

export const addHotspotProfile = async (profileData: any) => {
  return await hotspotApi.addProfile(getDeviceId(), profileData);
};

export const updateHotspotProfile = async (id: string, profileData: any) => {
  const { apiPut } = await import("@/lib/api-client");
  return await apiPut(`/hotspot/profiles/${id}`, { mikrotik_id: getDeviceId(), ...profileData });
};

export const deleteHotspotProfile = async (id: string) => {
  return await hotspotApi.deleteProfile(getDeviceId(), id);
};

export const getPPPoEProfiles = async () => {
  return await pppoeApi.profiles(getDeviceId());
};

export const addPPPoEProfile = async (profileData: any) => {
  return await pppoeApi.addProfile(getDeviceId(), profileData);
};

export const updatePPPoEProfile = async (id: string, profileData: any) => {
  const { apiPut } = await import("@/lib/api-client");
  return await apiPut(`/pppoe/profiles/${id}`, { mikrotik_id: getDeviceId(), ...profileData });
};

export const deletePPPoEProfile = async (id: string) => {
  return await pppoeApi.deleteProfile(getDeviceId(), id);
};

// Legacy exports for backwards compatibility
export const getMikroTikCredentials = getSelectedDevice;
export const saveMikroTikCredentials = (credentials: { host: string; username: string; password: string; port: string; version: string }) => {
  console.warn("saveMikroTikCredentials is deprecated. Use saveSelectedDevice instead.");
};
export const clearMikroTikCredentials = clearSelectedDevice;
