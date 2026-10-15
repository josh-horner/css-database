import { Linking } from "react-native";

/** Hands off to the tablet's maps app for turn-by-turn directions. */
export function openNavigation(lat: number, lng: number, label: string) {
  void Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
}
