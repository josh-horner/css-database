/** "Next up": one big card for what the crew should do now, then the rest of the route. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTRPC } from "@/lib/api";
import { openNavigation } from "@/lib/navigation";
import { useOutbox } from "@/lib/outbox";
import { BigButton, colors } from "@/lib/ui";

const STATUS_LABEL: Record<string, string> = {
  assigned: "Up next",
  en_route: "On the way",
  arrived: "At the stop",
  completed: "Done",
  unassigned: "Unassigned",
  failed: "Problem",
  on_hold: "On hold",
};

export default function Today() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const today = useQuery(trpc.crew.today.queryOptions());
  const outbox = useOutbox();
  const onMyWay = useMutation(trpc.crew.onMyWay.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));
  const arrive = useMutation(trpc.crew.arrive.mutationOptions({ onSuccess: () => qc.invalidateQueries() }));

  if (today.error) return <Message text={today.error.message} />;
  if (!today.data) return <Message text="Loading today's route…" />;
  const { crew, members, stops, nextJobId } = today.data;
  const next = stops.find((s) => s.jobId === nextJobId);
  const done = stops.filter((s) => s.status === "completed").length;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={today.isFetching} onRefresh={() => today.refetch()} />}>
      <View style={s.header}>
        <View style={[s.dot, { backgroundColor: crew.color }]} />
        <Text style={s.crew}>{crew.name}</Text>
        <Text style={s.muted}>
          {members.map((m) => `${m.firstName} (${m.role})`).join(" · ")} · {done}/{stops.length} done
        </Text>
      </View>
      {outbox.length > 0 && <Text style={s.sync}>{outbox.length} change{outbox.length === 1 ? "" : "s"} waiting to sync…</Text>}

      {next ? (
        <View style={s.card}>
          <Text style={s.kicker}>NEXT UP · STOP {next.sequence} OF {stops.length} · {STATUS_LABEL[next.status]}</Text>
          <Text style={s.title}>#{next.confirmationNumber} {next.customerName}</Text>
          <Text style={s.line}>{next.residence ?? next.address}{next.room ? ` · room ${next.room}` : ""}</Text>
          <Text style={s.muted}>{next.type} · {next.window}</Text>
          {next.notes && <Text style={s.note}>⚠ {next.notes}</Text>}
          <View style={s.actions}>
            {next.status === "assigned" && (
              <BigButton
                title="On my way"
                disabled={onMyWay.isPending}
                onPress={() => onMyWay.mutate({ jobId: next.jobId }, { onSuccess: () => openNavigation(next.lat, next.lng, next.address) })}
                style={{ flex: 1 }}
              />
            )}
            {next.status === "en_route" && (
              <>
                <BigButton title="Navigate" tone="plain" onPress={() => openNavigation(next.lat, next.lng, next.address)} style={{ flex: 1 }} />
                <BigButton title="Arrived" tone="green" disabled={arrive.isPending} onPress={() => arrive.mutate({ jobId: next.jobId }, { onSuccess: () => router.push(`/stop/${next.jobId}`) })} style={{ flex: 1 }} />
              </>
            )}
            {next.status === "arrived" && <BigButton title="Open contract" tone="green" onPress={() => router.push(`/stop/${next.jobId}`)} style={{ flex: 1 }} />}
          </View>
          {onMyWay.error && <Text style={s.error}>{onMyWay.error.message}</Text>}
          {onMyWay.data && <Text style={s.ok}>Texted the customer with your ETA and tracking link.</Text>}
        </View>
      ) : (
        <View style={s.card}>
          <Text style={s.title}>All stops done 🎉</Text>
          <Text style={s.muted}>Head back to the warehouse.</Text>
        </View>
      )}

      <Text style={s.section}>Today&apos;s route</Text>
      {stops.map((stop) => (
        <Pressable key={stop.jobId} onPress={() => router.push(`/stop/${stop.jobId}`)} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
          <Text style={s.seq}>{stop.sequence}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>#{stop.confirmationNumber} {stop.customerName}</Text>
            <Text style={s.muted}>{stop.residence ?? stop.address} · {stop.window}</Text>
          </View>
          <Text style={[s.badge, stop.status === "completed" ? { color: colors.green } : stop.jobId === nextJobId ? { color: colors.brand } : null]}>{STATUS_LABEL[stop.status]}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Message({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 18, color: colors.muted, textAlign: "center" }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 900, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dot: { width: 14, height: 14, borderRadius: 7 },
  crew: { fontSize: 22, fontWeight: "700", color: colors.ink },
  muted: { fontSize: 16, color: colors.muted },
  sync: { fontSize: 15, color: colors.amber },
  card: { backgroundColor: "white", borderRadius: 18, padding: 20, gap: 6, borderWidth: 1, borderColor: colors.line },
  kicker: { fontSize: 13, fontWeight: "700", color: colors.brand, letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink },
  line: { fontSize: 20, color: colors.ink },
  note: { fontSize: 17, color: colors.amber, marginTop: 4 },
  actions: { flexDirection: "row", gap: 12, marginTop: 12 },
  error: { color: colors.red, fontSize: 15 },
  ok: { color: colors.green, fontSize: 15 },
  section: { fontSize: 18, fontWeight: "700", marginTop: 8, color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "white", padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  seq: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, textAlign: "center", textAlignVertical: "center", fontWeight: "700", fontSize: 16 },
  rowTitle: { fontSize: 17, fontWeight: "600", color: colors.ink },
  badge: { fontSize: 14, fontWeight: "600", color: colors.muted },
});
