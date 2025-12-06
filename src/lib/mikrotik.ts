import { supabase } from "@/integrations/supabase/client";

export interface MikroTikDeviceConfig {
  id: string;
  name: string;
  host: string;
  port: string;
  version: string;
}

export const saveSelectedDevice = (device: MikroTikDeviceConfig) => {
  // Only store non-sensitive device info - NO passwords or usernames
  localStorage.setItem("mikrotik_device_id", device.id);
  localStorage.setItem("mikrotik_connected", "true");
  localStorage.setItem("mikrotik_host", device.host);
  localStorage.setItem("mikrotik_version", device.version);
  localStorage.setItem("mikrotik_device_name", device.name);
  localStorage.setItem("mikrotik_port", device.port);
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
  // Also clean up legacy keys if present
  localStorage.removeItem("mikrotik_config");
};

// Legacy compatibility - remove old credential storage if present
export const cleanupLegacyStorage = () => {
  const legacyConfig = localStorage.getItem("mikrotik_config");
  if (legacyConfig) {
    localStorage.removeItem("mikrotik_config");
  }
};

export const callMikroTikFunction = async (
  functionName: string,
  params: Record<string, any>
) => {
  const device = getSelectedDevice();
  
  if (!device) {
    throw new Error("No hay dispositivo MikroTik seleccionado");
  }

  // Pass only the device ID - credentials will be fetched server-side
  const commonParams = {
    mikrotikId: device.id,
  };

  // If version v6, use binary API
  if (device.version === "v6") {
    const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
      body: {
        ...commonParams,
        command: params.command || functionName,
        params: params.params || {},
      },
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error);
    return data.data;
  }

  // For v7, use REST API
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: {
      ...commonParams,
      ...params,
    },
  });

  if (error) throw error;
  if (!data.success) throw new Error(data.error);

  return data.data;
};

export const testMikroTikConnection = async (mikrotikId: string, version: string) => {
  // Test connection using device ID - credentials fetched server-side
  if (version === "v6") {
    const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
      body: {
        mikrotikId,
        command: "/system/resource/print",
        params: {},
      },
    });

    if (error) throw error;
    return { success: true, data: data.data };
  }

  // For v7, use REST API
  const { data, error } = await supabase.functions.invoke("mikrotik-connect", {
    body: {
      mikrotikId,
    },
  });

  if (error) throw error;
  return data;
};

export const getHotspotUsers = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-users", {
      command: "hotspot-users",
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "list",
  });
};

export const addHotspotUser = async (userData: {
  name: string;
  password: string;
  profile?: string;
  limit?: string;
}) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-user-add", {
      command: "hotspot-user-add",
      params: {
        name: userData.name,
        password: userData.password,
        profile: userData.profile || "default",
      },
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "add",
    userData,
  });
};

export const removeHotspotUser = async (userId: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-user-remove", {
      command: "hotspot-user-remove",
      params: {
        ".id": userId,
      },
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "remove",
    userId,
  });
};

export const getSystemInfo = async (type: string = "resources") => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    const commandMap: Record<string, string> = {
      "resources": "system-resource",
      "interfaces": "interfaces",
      "ppp": "ppp",
      "hotspot-active": "hotspot-active",
    };
    return await callMikroTikFunction(commandMap[type] || "system-resource", {
      command: commandMap[type] || "system-resource",
    });
  }
  return await callMikroTikFunction("mikrotik-system-info", {
    type,
  });
};

export const getPPPoEUsers = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("ppp-secrets", {
      command: "ppp-secrets",
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "list",
  });
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
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("ppp-secret-add", {
      command: "ppp-secret-add",
      params: userData,
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "add",
    userData,
  });
};

export const removePPPoEUser = async (userId: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("ppp-secret-remove", {
      command: "ppp-secret-remove",
      params: { ".id": userId },
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "remove",
    userData: { id: userId },
  });
};

export const togglePPPoEUser = async (userId: string, currentlyDisabled: boolean) => {
  const device = getSelectedDevice();
  const command = currentlyDisabled ? "ppp-secret-enable" : "ppp-secret-disable";
  
  if (device?.version === "v6") {
    return await callMikroTikFunction(command, {
      command,
      params: { ".id": userId },
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: currentlyDisabled ? "enable" : "disable",
    userData: { id: userId },
  });
};

export const disconnectPPPoEUser = async (connectionId: string) => {
  const device = getSelectedDevice();
  
  if (device?.version === "v6") {
    return await callMikroTikFunction("ppp-active-remove", {
      command: "ppp-active-remove",
      params: { ".id": connectionId },
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "disconnect",
    userData: { id: connectionId },
  });
};

export const getPPPoEActive = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("ppp-active", {
      command: "ppp-active",
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "active",
  });
};

export const generateVouchers = async (count: number, profile?: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    // For v6, generate vouchers directly with hotspot users
    const vouchers = [];
    for (let i = 0; i < count; i++) {
      const username = Math.random().toString(36).substring(2, 10).toUpperCase();
      const password = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      await callMikroTikFunction("hotspot-user-add", {
        command: "hotspot-user-add",
        params: {
          name: username,
          password: password,
          profile: profile || "default",
          comment: `Voucher ${new Date().toISOString()}`,
        },
      });
      vouchers.push({ username, password, profile: profile || "default" });
    }
    return vouchers;
  }
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "generate",
    count,
    voucherData: { profile },
  });
};

export const getVouchers = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    // For v6, vouchers are hotspot users
    return await callMikroTikFunction("hotspot-users", {
      command: "hotspot-users",
    });
  }
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "list",
  });
};

export const deleteVoucher = async (voucherId: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-user-remove", {
      command: "hotspot-user-remove",
      params: {
        ".id": voucherId,
      },
    });
  }
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "delete",
    voucherData: { id: voucherId },
  });
};

// Profiles Management
export const getHotspotProfiles = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-profiles", {
      command: "hotspot-profiles",
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "profiles",
  });
};

export const addHotspotProfile = async (profileData: any) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-profile-add", {
      command: "hotspot-profile-add",
      params: profileData,
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "profile-add",
    profileData,
  });
};

export const updateHotspotProfile = async (id: string, profileData: any) => {
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "profile-update",
    id,
    profileData,
  });
};

export const deleteHotspotProfile = async (id: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("hotspot-profile-delete", {
      command: "hotspot-profile-delete",
      params: { ".id": id },
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "profile-delete",
    id,
  });
};

export const getPPPoEProfiles = async () => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("pppoe-profiles", {
      command: "pppoe-profiles",
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "profiles",
  });
};

export const addPPPoEProfile = async (profileData: any) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("pppoe-profile-add", {
      command: "pppoe-profile-add",
      params: profileData,
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "profile-add",
    profileData,
  });
};

export const updatePPPoEProfile = async (id: string, profileData: any) => {
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "profile-update",
    id,
    profileData,
  });
};

export const deletePPPoEProfile = async (id: string) => {
  const device = getSelectedDevice();
  if (device?.version === "v6") {
    return await callMikroTikFunction("pppoe-profile-delete", {
      command: "pppoe-profile-delete",
      params: { ".id": id },
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "profile-delete",
    id,
  });
};

// Legacy exports for backwards compatibility during migration
export const getMikroTikCredentials = getSelectedDevice;
export const saveMikroTikCredentials = (credentials: { host: string; username: string; password: string; port: string; version: string }) => {
  // This is a legacy function - should not be used
  console.warn("saveMikroTikCredentials is deprecated. Use saveSelectedDevice instead.");
};
export const clearMikroTikCredentials = clearSelectedDevice;
