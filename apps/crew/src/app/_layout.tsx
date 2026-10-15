import { Stack } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ApiProvider, useApiClient } from "@/lib/api";
import { useShareLocation } from "@/lib/location";
import { flush } from "@/lib/outbox";
import { loadPairing, type Pairing } from "@/lib/pairing";
import { PairScreen } from "@/lib/pair-screen";

export default function RootLayout() {
  useKeepAwake(); // The route screen stays on all shift.
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  useEffect(() => {
    loadPairing().then(setPairing);
  }, []);

  if (pairing === undefined)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  if (!pairing) return <PairScreen onPaired={setPairing} />;

  return (
    <ApiProvider pairing={pairing}>
      <Background />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTitleStyle: { fontWeight: "700" } }}>
        <Stack.Screen name="index" options={{ title: "CSS Crew" }} />
        <Stack.Screen name="stop/[jobId]" options={{ title: "Stop" }} />
        <Stack.Screen name="stop/add" options={{ title: "Add item", presentation: "modal" }} />
      </Stack>
    </ApiProvider>
  );
}

/** Keeps the outbox draining and the crew's location flowing while the app is open. */
function Background() {
  const { client, pairing } = useApiClient();
  useShareLocation(true);
  useEffect(() => {
    const t = setInterval(() => void flush(client, pairing), 5_000);
    void flush(client, pairing);
    return () => clearInterval(t);
  }, [client, pairing]);
  return null;
}
