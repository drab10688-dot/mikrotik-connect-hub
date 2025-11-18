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
};

export const getMikroTikCredentials = (): MikroTikCredentials | null => {
  const config = localStorage.getItem("mikrotik_config");
  return config ? JSON.parse(config) : null;
};

export const clearMikroTikCredentials = () => {
  localStorage.removeItem("mikrotik_config");
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
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "add",
    userData,
  });
};

export const removePPPoEUser = async (userId: string) => {
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "remove",
    userData: { id: userId },
  });
};

export const getPPPoEActive = async () => {
  return await callMikroTikFunction("mikrotik-pppoe", {
    action: "active",
  });
};

export const generateVouchers = async (count: number, profile?: string) => {
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "generate",
    count,
    voucherData: { profile },
  });
};

export const getVouchers = async () => {
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "list",
  });
};

export const deleteVoucher = async (voucherId: string) => {
  return await callMikroTikFunction("mikrotik-vouchers", {
    action: "delete",
    voucherData: { id: voucherId },
  });
};
