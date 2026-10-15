/** One stop: details, the digital contract, signature, and completion. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useApiClient, useTRPC } from "@/lib/api";
import { flush, removePending, useOutbox } from "@/lib/outbox";
import { BigButton, colors } from "@/lib/ui";
import { openNavigation } from "@/lib/navigation";

export default function StopScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { client, pairing } = useApiClient();
  const today = useQuery(trpc.crew.today.queryOptions());
  const outbox = useOutbox();
  const [signedBy, setSignedBy] = useState("");
  const invalidate = () => qc.invalidateQueries();
  const arrive = useMutation(trpc.crew.arrive.mutationOptions({ onSuccess: invalidate }));
  const removeItem = useMutation(trpc.crew.removeItem.mutationOptions({ onSuccess: invalidate }));
  const complete = useMutation(trpc.crew.complete.mutationOptions({ onSuccess: () => (invalidate(), router.back()) }));

  const stop = today.data?.stops.find((x) => x.jobId === jobId);
  if (!stop) return <Text style={{ padding: 24, fontSize: 18 }}>Loading…</Text>;

  const pending = outbox.filter((c) => c.kind === "saveItem" && c.item.jobId === jobId).map((c) => (c.kind === "saveItem" ? c.item : null)!);
  const pendingPhotos = outbox.filter((c) => c.kind === "photo" && c.jobId === jobId).length;
  const serverClientIds = new Set(stop.items.map((i) => i.clientId));
  const lines = [
    ...stop.items.map((i) => ({ key: i.id, label: i.description ?? "", quantity: i.quantity, damage: i.preExistingDamage, photos: i.photoIds.length, pending: false, serverId: i.id, clientId: i.clientId })),
    ...pending.filter((p) => !serverClientIds.has(p.clientId)).map((p) => ({ key: p.clientId, label: p.label, quantity: p.quantity, damage: p.preExistingDamage, photos: 0, pending: true, serverId: null, clientId: p.clientId })),
  ];
  const done = stop.status === "completed";

  async function finish() {
    await flush(client, pairing);
    complete.mutate({ jobId: stop!.jobId, signedByName: signedBy.trim() || null });
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page}>
      <Stack.Screen options={{ title: `Stop ${stop.sequence} · #${stop.confirmationNumber}` }} />
      <View style={s.card}>
        <Text style={s.title}>{stop.customerName}</Text>
        <Text style={s.line}>{stop.residence ?? stop.address}{stop.room ? ` · room ${stop.room}` : ""}</Text>
        <Text style={s.muted}>{stop.type} · {stop.window}</Text>
        {stop.notes && <Text style={s.note}>⚠ {stop.notes}</Text>}
        <View style={s.row}>
          <BigButton title="Navigate" tone="plain" onPress={() => openNavigation(stop.lat, stop.lng, stop.address)} style={{ flex: 1 }} />
          {stop.customerPhone && <BigButton title="Call" tone="plain" onPress={() => Linking.openURL(`tel:${stop.customerPhone}`)} style={{ flex: 1 }} />}
          {(stop.status === "assigned" || stop.status === "en_route") && (
            <BigButton title="Arrived" tone="green" onPress={() => arrive.mutate({ jobId: stop.jobId })} style={{ flex: 1 }} />
          )}
        </View>
      </View>

      <View style={s.card}>
        <View style={[s.row, { justifyContent: "space-between", alignItems: "center", marginTop: 0 }]}>
          <Text style={s.section}>Contract</Text>
          {!done && <BigButton title="+ Add item" onPress={() => router.push({ pathname: "/stop/add", params: { jobId: stop.jobId } })} style={{ paddingVertical: 12 }} />}
        </View>
        {lines.length === 0 && <Text style={s.muted}>Nothing yet. Add each item: pick it, set the quantity, take a photo.</Text>}
        {lines.map((l) => (
          <View key={l.key} style={s.item}>
            <Text style={s.qty}>{l.quantity}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.itemTitle}>{l.label}</Text>
              <Text style={s.muted}>
                {l.pending ? "waiting to sync" : `${l.photos} photo${l.photos === 1 ? "" : "s"}`}
                {l.damage ? ` · damage noted: ${l.damage}` : ""}
              </Text>
            </View>
            {!done && (
              <Pressable
                onPress={() =>
                  Alert.alert("Remove this line?", l.label, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => (l.serverId ? removeItem.mutate({ itemId: l.serverId }) : removePending(l.clientId!)) },
                  ])
                }
              >
                <Text style={{ color: colors.red, fontSize: 16, padding: 8 }}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
        {pendingPhotos > 0 && <Text style={s.sync}>{pendingPhotos} photo{pendingPhotos === 1 ? "" : "s"} waiting to upload</Text>}
      </View>

      {done ? (
        <View style={s.card}>
          <Text style={[s.section, { color: colors.green }]}>Completed{stop.signedByName ? ` · signed by ${stop.signedByName}` : ""}</Text>
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.section}>Customer sign-off</Text>
          <Text style={s.muted}>Show the customer the list and any damage noted. They type their name to sign.</Text>
          <TextInput value={signedBy} onChangeText={setSignedBy} placeholder="Customer's full name" style={s.input} />
          <BigButton title={complete.isPending ? "Completing…" : `Complete ${stop.type}`} tone="green" disabled={complete.isPending || lines.length === 0 || !signedBy.trim()} onPress={finish} />
          {complete.error && <Text style={s.error}>{complete.error.message}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 900, width: "100%", alignSelf: "center" },
  card: { backgroundColor: "white", borderRadius: 18, padding: 20, gap: 8, borderWidth: 1, borderColor: colors.line },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink },
  line: { fontSize: 19, color: colors.ink },
  muted: { fontSize: 15, color: colors.muted },
  note: { fontSize: 17, color: colors.amber },
  row: { flexDirection: "row", gap: 12, marginTop: 8 },
  section: { fontSize: 20, fontWeight: "700", color: colors.ink },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  qty: { fontSize: 22, fontWeight: "800", width: 56, color: colors.brand },
  itemTitle: { fontSize: 18, fontWeight: "600", color: colors.ink },
  sync: { fontSize: 15, color: colors.amber },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, fontSize: 18 },
  error: { color: colors.red, fontSize: 15 },
});
