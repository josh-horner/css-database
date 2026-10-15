import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from "react-native";
import { savePairing, type Pairing } from "./pairing";
import { BigButton, colors } from "./ui";

/** One-time setup per tablet: the office gives the crew lead a server address and device code. */
export function PairScreen({ onPaired }: { onPaired: (p: Pairing) => void }) {
  const [apiUrl, setApiUrl] = useState("http://192.168.1.10:4100");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pair() {
    setBusy(true);
    setError(null);
    try {
      const url = apiUrl.replace(/\/+$/, "");
      const res = await fetch(`${url}/trpc/crew.today`, { headers: { authorization: `Bearer ${token.trim()}` } });
      if (res.status === 401) throw new Error("That device code isn't recognized.");
      if (!res.ok && res.status !== 412) throw new Error(`Server answered ${res.status}`);
      const p = { apiUrl: url, token: token.trim() };
      await savePairing(p);
      onPaired(p);
    } catch (e) {
      setError((e as Error).message.includes("Network") ? "Can't reach the server. Check the address and Wi-Fi/data." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={s.wrap}>
      <View style={s.card}>
        <Text style={s.title}>Set up this tablet</Text>
        <Text style={s.help}>Enter the server address and device code from the office.</Text>
        <Text style={s.label}>Server address</Text>
        <TextInput style={s.input} value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Text style={s.label}>Device code</Text>
        <TextInput style={s.input} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
        {error && <Text style={s.error}>{error}</Text>}
        <BigButton title={busy ? "Checking…" : "Pair tablet"} onPress={pair} disabled={busy || !token.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg, padding: 16 },
  card: { width: "100%", maxWidth: 520, backgroundColor: "white", borderRadius: 16, padding: 24, gap: 10 },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink },
  help: { fontSize: 16, color: colors.muted, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, fontSize: 18 },
  error: { color: colors.red, fontSize: 15 },
});
