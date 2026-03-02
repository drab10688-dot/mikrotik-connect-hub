import { useEffect, useRef, useState } from "react";
import { useHotspotActiveUsers, usePPPoEActive, useVouchers } from "./useMikrotikData";
import { toast } from "@/hooks/use-toast";

export interface Notification {
  id: string;
  type: "connection" | "disconnection" | "voucher_expiry" | "system_alert";
  title: string;
  description: string;
  timestamp: Date;
  read: boolean;
  severity: "info" | "warning" | "error";
}

export const useRealtimeNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const { data: hotspotActive } = useHotspotActiveUsers();
  const { data: pppoeActive } = usePPPoEActive();
  const { data: vouchers } = useVouchers();

  const prevHotspotActive = useRef<any>(null);
  const prevPPPoEActive = useRef<any>(null);
  const prevVouchers = useRef<any>(null);
  const notifiedVouchers = useRef<Set<string>>(new Set());

  const addNotification = (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      read: false,
    };

    setNotifications(prev => [newNotification, ...prev].slice(0, 50));
    setUnreadCount(prev => prev + 1);

    toast({
      title: notification.title,
      description: notification.description,
      variant: notification.severity === "error" ? "destructive" : "default",
    });
  };

  // Monitor Hotspot connections
  useEffect(() => {
    const currentData = Array.isArray(hotspotActive) ? hotspotActive : [];
    if (!currentData.length || !prevHotspotActive.current) {
      prevHotspotActive.current = currentData;
      return;
    }

    const previous = prevHotspotActive.current;

    const newConnections = currentData.filter(
      (user: any) => !previous.find((p: any) => p[".id"] === user[".id"])
    );

    newConnections.forEach((user: any) => {
      addNotification({
        type: "connection",
        title: "Nueva Conexión Hotspot",
        description: `Usuario ${user.user || "desconocido"} se ha conectado`,
        severity: "info",
      });
    });

    const disconnections = previous.filter(
      (user: any) => !currentData.find((c: any) => c[".id"] === user[".id"])
    );

    disconnections.forEach((user: any) => {
      addNotification({
        type: "disconnection",
        title: "Desconexión Hotspot",
        description: `Usuario ${user.user || "desconocido"} se ha desconectado`,
        severity: "info",
      });
    });

    prevHotspotActive.current = currentData;
  }, [hotspotActive]);

  // Monitor PPPoE connections
  useEffect(() => {
    const currentData = Array.isArray(pppoeActive) ? pppoeActive : [];
    if (!currentData.length || !prevPPPoEActive.current) {
      prevPPPoEActive.current = currentData;
      return;
    }

    const previous = prevPPPoEActive.current;

    const newConnections = currentData.filter(
      (user: any) => !previous.find((p: any) => p[".id"] === user[".id"])
    );

    newConnections.forEach((user: any) => {
      addNotification({
        type: "connection",
        title: "Nueva Conexión PPPoE",
        description: `Usuario ${user.name || "desconocido"} se ha conectado`,
        severity: "info",
      });
    });

    const disconnections = previous.filter(
      (user: any) => !currentData.find((c: any) => c[".id"] === user[".id"])
    );

    disconnections.forEach((user: any) => {
      addNotification({
        type: "disconnection",
        title: "Desconexión PPPoE",
        description: `Usuario ${user.name || "desconocido"} se ha desconectado`,
        severity: "info",
      });
    });

    prevPPPoEActive.current = currentData;
  }, [pppoeActive]);

  // Monitor voucher expiry
  useEffect(() => {
    const voucherData = Array.isArray(vouchers) ? vouchers : [];
    if (!voucherData.length) return;

    voucherData.forEach((voucher: any) => {
      if (!voucher.uptime || notifiedVouchers.current.has(voucher.name)) return;

      const uptimeMatch = voucher.uptime.match(/(\d+)([mhd])/);
      if (!uptimeMatch) return;

      const value = parseInt(uptimeMatch[1]);
      const unit = uptimeMatch[2];

      let expiryMs = 0;
      switch (unit) {
        case 'm': expiryMs = value * 60 * 1000; break;
        case 'h': expiryMs = value * 60 * 60 * 1000; break;
        case 'd': expiryMs = value * 24 * 60 * 60 * 1000; break;
      }

      if (expiryMs > 0 && expiryMs <= 60 * 60 * 1000) {
        addNotification({
          type: "voucher_expiry",
          title: "Voucher Próximo a Vencer",
          description: `El voucher ${voucher.name} expirará pronto (${voucher.uptime})`,
          severity: "warning",
        });
        notifiedVouchers.current.add(voucher.name);
      }
    });
  }, [vouchers]);

  // System alerts based on resource usage
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const hotspotCount = Array.isArray(hotspotActive) ? hotspotActive.length : 0;
      const pppoeCount = Array.isArray(pppoeActive) ? pppoeActive.length : 0;
      const totalConnections = hotspotCount + pppoeCount;

      if (totalConnections > 100) {
        addNotification({
          type: "system_alert",
          title: "Alta Carga de Conexiones",
          description: `${totalConnections} conexiones activas detectadas`,
          severity: "warning",
        });
      }
    }, 60000);

    return () => clearInterval(checkInterval);
  }, [hotspotActive, pppoeActive]);

  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(notif => (notif.id === id ? { ...notif, read: true } : notif))
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(notif => ({ ...notif, read: true })));
    setUnreadCount(0);
  };

  const clearNotification = (id: string) => {
    setNotifications(prev => prev.filter(notif => notif.id !== id));
    setUnreadCount(prev => {
      const notif = notifications.find(n => n.id === id);
      return notif && !notif.read ? Math.max(0, prev - 1) : prev;
    });
  };

  const clearAll = () => {
    setNotifications([]);
    setUnreadCount(0);
  };

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAll,
  };
};
