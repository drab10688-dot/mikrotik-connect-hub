
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

// ─── Comando genérico a la MikroTik vía API del VPS ─────

export const callMikroTikFunction = async (
  functionName: string,
  params: Record<string, any>
) => {
  const mikrotikId = getSelectedDeviceId();
  if (!mikrotikId) throw new Error("No hay dispositivo MikroTik seleccionado");
  const { apiPost } = await import("@/lib/api-client");
  const response = await apiPost(`/system/mikrotik/command`, {
    mikrotik_id: mikrotikId,
    command: functionName,
    params,
  });
  return (response as any)?.data ?? response;
};
