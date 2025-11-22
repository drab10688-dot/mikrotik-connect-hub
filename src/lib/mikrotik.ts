import { supabase } from "@/integrations/supabase/client";

export interface MikroTikCredentials {
  host: string;
  username: string;
  password: string;
  port: string;
  version: string;
}

export const saveMikroTikCredentials = (credentials: MikroTikCredentials) => {
  localStorage.setItem("mikrotik_config", JSON.stringify(credentials));
  localStorage.setItem("mikrotik_connected", "true");
  localStorage.setItem("mikrotik_host", credentials.host);
  localStorage.setItem("mikrotik_version", credentials.version);
};

export const getMikroTikCredentials = (): MikroTikCredentials | null => {
  const config = localStorage.getItem("mikrotik_config");
  return config ? JSON.parse(config) : null;
};

export const clearMikroTikCredentials = () => {
  localStorage.removeItem("mikrotik_config");
  localStorage.removeItem("mikrotik_connected");
  localStorage.removeItem("mikrotik_host");
  localStorage.removeItem("mikrotik_version");
};

export const callMikroTikFunction = async (
  functionName: string,
  params: Record<string, any>
) => {
  const credentials = getMikroTikCredentials();
  
  if (!credentials) {
    throw new Error("No hay credenciales de MikroTik guardadas");
  }

  // Si es v6, usar la API binaria
  if (credentials.version === "v6") {
    const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
      body: {
        host: credentials.host,
        username: credentials.username,
        password: credentials.password,
        port: parseInt(credentials.port),
        command: params.command || functionName,
        params: params.params || {},
      },
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error);
    return data.data;
  }

  // Para v7, usar REST API
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: {
      ...credentials,
      port: parseInt(credentials.port),
      ...params,
    },
  });

  if (error) throw error;
  if (!data.success) throw new Error(data.error);

  return data.data;
};

export const testMikroTikConnection = async (credentials: MikroTikCredentials) => {
  // Si es v6, usar la API binaria
  if (credentials.version === "v6") {
    const { data, error } = await supabase.functions.invoke("mikrotik-v6-api", {
      body: {
        host: credentials.host,
        username: credentials.username,
        password: credentials.password,
        port: parseInt(credentials.port),
        command: "/system/resource/print",
        params: {},
      },
    });

    if (error) throw error;
    return { success: true, data: data.data };
  }

  // Para v7, usar REST API
  const { data, error } = await supabase.functions.invoke("mikrotik-connect", {
    body: {
      ...credentials,
      port: parseInt(credentials.port),
    },
  });

  if (error) throw error;
  return data;
};

export const getHotspotUsers = async () => {
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  const command = currentlyDisabled ? "ppp-secret-enable" : "ppp-secret-disable";
  
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
    return await callMikroTikFunction("ppp-active", {
      command: "ppp-active",
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "active",
  });
};

export const generateVouchers = async (count: number, profile?: string) => {
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
    // Para v6, generamos vouchers directamente con hotspot users
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
    // Para v6, los vouchers son usuarios hotspot
    return await callMikroTikFunction("hotspot-users", {
      command: "hotspot-users",
    });
  }
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "list",
  });
};

export const deleteVoucher = async (voucherId: string) => {
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
    return await callMikroTikFunction("hotspot-profiles", {
      command: "hotspot-profiles",
    });
  }
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "profiles",
  });
};

export const addHotspotProfile = async (profileData: any) => {
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
    return await callMikroTikFunction("pppoe-profiles", {
      command: "pppoe-profiles",
    });
  }
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "profiles",
  });
};

export const addPPPoEProfile = async (profileData: any) => {
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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
  const credentials = getMikroTikCredentials();
  if (credentials?.version === "v6") {
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

// Backup y Restore
export const exportMikroTikConfig = async (section: 'pppoe-users' | 'pppoe-profiles' | 'hotspot-users' | 'hotspot-profiles' | 'simple-queues' | 'all') => {
  return callMikroTikFunction("mikrotik-v6-api", {
    command: "export-config",
    params: { section }
  });
};

export const importMikroTikConfig = async (script: string) => {
  return callMikroTikFunction("mikrotik-v6-api", {
    command: "import-config",
    params: { script }
  });
};
