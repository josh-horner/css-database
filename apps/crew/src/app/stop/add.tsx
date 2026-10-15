/** Add a contract line: pick the item (or Other), set quantity, note damage, take photos. Works offline. */
import { useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { formatCents } from "@css/domain";
import { useTRPC } from "@/lib/api";
import { enqueue, newId } from "@/lib/outbox";
import { BigButton, colors } from "@/lib/ui";

async function shrink(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1568, height: null });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  return saved.uri;
}

export default function AddItem() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const trpc = useTRPC();
  const rateCard = useQuery(trpc.crew.rateCard.queryOptions(undefined, { staleTime: 60 * 60_000 }));
  const [itemId, setItemId] = useState<string | "other" | null>(null);
  const [other, setOther] = useState("");
  const [qty, setQty] = useState(1);
  const [damage, setDamage] = useState("");
  const [search, setSearch] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rateCard.data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rateCard.data, search]);
  const chosen = rateCard.data?.find((r) => r.id === itemId);
  const label = itemId === "other" ? other.trim() : (chosen?.name ?? "");
  const canSave = !!label && qty >= 1 && photos.length > 0;

  async function snap() {
    const photo = await camera.current?.takePictureAsync({ quality: 0.8 });
    if (!photo) return;
    setPhotos((p) => [...p, photo.uri]);
    setCameraOpen(false);
  }

  async function save() {
    const clientId = newId();
    enqueue({
      id: newId(),
      kind: "saveItem",
      item: {
        jobId: jobId!,
        clientId,
        rateCardItemId: itemId === "other" ? null : itemId,
        description: itemId === "other" ? other.trim() : null,
        quantity: qty,
        preExistingDamage: damage.trim() || null,
        label,
      },
    });
    for (const uri of photos) {
      enqueue({ id: newId(), kind: "photo", jobId: jobId!, clientId: newId(), uri: await shrink(uri), photoKind: "item", itemClientId: clientId });
    }
    router.back();
  }

  if (cameraOpen) {
    if (!permission?.granted)
      return (
        <View style={s.center}>
          <Text style={s.muted}>The camera is needed to photograph items.</Text>
          <BigButton title="Allow camera" onPress={requestPermission} />
        </View>
      );
    return (
      <View style={{ flex: 1, backgroundColor: "black" }}>
        <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        <View style={s.cameraBar}>
          <BigButton title="Cancel" tone="plain" onPress={() => setCameraOpen(false)} style={{ flex: 1, backgroundColor: "white" }} />
          <BigButton title="Take photo" onPress={snap} style={{ flex: 2 }} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.section}>1. What is it?</Text>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search (box, fridge, bike…)" style={s.input} />
      <View style={s.grid}>
        {items.map((r) => (
          <Pressable key={r.id} onPress={() => setItemId(r.id)} style={[s.chip, itemId === r.id && s.chipOn]}>
            <Text style={[s.chipText, itemId === r.id && { color: "white" }]}>{r.name}</Text>
            <Text style={[s.chipPrice, itemId === r.id && { color: "#dbeafe" }]}>{formatCents(r.unitPriceCents)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setItemId("other")} style={[s.chip, itemId === "other" && s.chipOn]}>
          <Text style={[s.chipText, itemId === "other" && { color: "white" }]}>Other…</Text>
          <Text style={[s.chipPrice, itemId === "other" && { color: "#dbeafe" }]}>owner prices</Text>
        </Pressable>
      </View>
      {itemId === "other" && <TextInput value={other} onChangeText={setOther} placeholder="Describe it (e.g. kayak, 10 ft)" style={s.input} />}

      <Text style={s.section}>2. How many?</Text>
      <View style={s.stepper}>
        <BigButton title="−" tone="plain" onPress={() => setQty((q) => Math.max(1, q - 1))} style={s.stepBtn} />
        <Text style={s.qty}>{qty}</Text>
        <BigButton title="+" tone="plain" onPress={() => setQty((q) => q + 1)} style={s.stepBtn} />
      </View>

      <Text style={s.section}>3. Photos</Text>
      <View style={s.grid}>
        {photos.map((uri) => (
          <Image key={uri} source={{ uri }} style={s.thumb} />
        ))}
        <Pressable onPress={() => setCameraOpen(true)} style={[s.thumb, s.addPhoto]}>
          <Text style={{ fontSize: 16, color: colors.brand, fontWeight: "700" }}>+ Photo</Text>
        </Pressable>
      </View>

      <Text style={s.section}>Damage already there? (optional)</Text>
      <TextInput value={damage} onChangeText={setDamage} placeholder="e.g. dent on fridge door" style={s.input} />

      <BigButton title={canSave ? `Add ${qty}× ${label}` : "Pick an item and take a photo"} disabled={!canSave} onPress={save} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 900, width: "100%", alignSelf: "center" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, padding: 24 },
  section: { fontSize: 20, fontWeight: "700", color: colors.ink, marginTop: 4 },
  muted: { fontSize: 16, color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, fontSize: 18, backgroundColor: "white" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: colors.line, minWidth: 150 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 17, fontWeight: "600", color: colors.ink },
  chipPrice: { fontSize: 13, color: colors.muted },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn: { width: 72 },
  qty: { fontSize: 36, fontWeight: "800", minWidth: 60, textAlign: "center" },
  thumb: { width: 110, height: 110, borderRadius: 12 },
  addPhoto: { borderWidth: 2, borderStyle: "dashed", borderColor: colors.brand, alignItems: "center", justifyContent: "center", backgroundColor: "white" },
  cameraBar: { flexDirection: "row", gap: 12, padding: 16, backgroundColor: "black" },
});
