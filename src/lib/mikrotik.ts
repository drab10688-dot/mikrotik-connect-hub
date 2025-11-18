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
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "add",
    userData,
  });
};

export const removeHotspotUser = async (userId: string) => {
  return await callMikroTikFunction("mikrotik-hotspot-users", {
    action: "remove",
    userId,
  });
};

export const getSystemInfo = async (type: string = "resources") => {
  return await callMikroTikFunction("mikrotik-system-info", {
    type,
  });
};
