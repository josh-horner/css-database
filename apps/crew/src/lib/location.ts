/** Shares the crew's position during the shift (foreground only), batched every 30 seconds. */
import * as Location from "expo-location";
import { useEffect } from "react";
import { useApiClient } from "./api";

export function useShareLocation(enabled: boolean) {
  const { client } = useApiClient();
  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let buffer: { lat: number; lng: number; accuracyM: number | null; recordedAt: Date }[] = [];
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || cancelled) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 15 }, (loc) => {
        buffer.push({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracyM: loc.coords.accuracy ?? null, recordedAt: new Date(loc.timestamp) });
      });
    })();
    const timer = setInterval(async () => {
      if (!buffer.length) return;
      const points = buffer;
      buffer = [];
      try {
        await client.crew.location.mutate({ points });
      } catch {
        buffer = [...points.slice(-50), ...buffer]; // keep the latest few if offline
      }
    }, 30_000);
    return () => {
      cancelled = true;
      sub?.remove();
      clearInterval(timer);
    };
  }, [enabled, client]);
}
