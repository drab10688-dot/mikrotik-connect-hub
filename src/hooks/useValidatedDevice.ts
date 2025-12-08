import { useEffect, useState } from "react";
import { getSelectedDevice, clearSelectedDevice, saveSelectedDevice, MikroTikDeviceConfig } from "@/lib/mikrotik";
import { useUserDeviceAccess } from "./useUserDeviceAccess";
import { toast } from "sonner";

/**
 * Hook that validates the selected device against user's accessible devices.
 * If the stored device is not accessible, it clears the selection and optionally
 * auto-selects the first available device.
 */
export function useValidatedDevice(autoSelectFirst: boolean = true) {
  const { devices, isLoading } = useUserDeviceAccess();
  const [validatedDevice, setValidatedDevice] = useState<MikroTikDeviceConfig | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    if (isLoading) return;

    const storedDevice = getSelectedDevice();
    const storedDeviceId = storedDevice?.id;

    if (!devices || devices.length === 0) {
      // No devices available
      if (storedDeviceId) {
        clearSelectedDevice();
      }
      setValidatedDevice(null);
      setIsValidating(false);
      return;
    }

    if (storedDeviceId) {
      // Check if stored device is in user's accessible devices
      const accessibleDevice = devices.find((d: any) => d.id === storedDeviceId);
      
      if (accessibleDevice) {
        // Device is valid, ensure it's properly stored
        setValidatedDevice({
          id: accessibleDevice.id,
          name: accessibleDevice.name,
          host: accessibleDevice.host,
          port: accessibleDevice.port,
          version: accessibleDevice.version,
        });
        setIsValidating(false);
        return;
      } else {
        // Device is not accessible, clear it
        console.log("Clearing invalid device selection:", storedDeviceId);
        clearSelectedDevice();
        toast.info("El dispositivo seleccionado ya no está disponible");
      }
    }

    // No valid device stored, auto-select first if enabled
    if (autoSelectFirst && devices.length > 0) {
      const firstDevice = devices[0];
      const deviceConfig: MikroTikDeviceConfig = {
        id: firstDevice.id,
        name: firstDevice.name,
        host: firstDevice.host,
        port: firstDevice.port,
        version: firstDevice.version,
      };
      saveSelectedDevice(deviceConfig);
      localStorage.setItem("mikrotik_connected", "true");
      setValidatedDevice(deviceConfig);
      toast.success(`Conectado a ${firstDevice.name}`);
    } else {
      setValidatedDevice(null);
    }

    setIsValidating(false);
  }, [devices, isLoading, autoSelectFirst]);

  return {
    device: validatedDevice,
    isValidating: isLoading || isValidating,
    hasValidDevice: !!validatedDevice,
    availableDevices: devices,
  };
}
