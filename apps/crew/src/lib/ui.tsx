import { Pressable, StyleSheet, Text, type PressableProps, type ViewStyle } from "react-native";

export const colors = {
  brand: "#1d4ed8",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  bg: "#f8fafc",
  green: "#16a34a",
  amber: "#b45309",
  red: "#dc2626",
};

export function BigButton({ title, tone = "brand", style, ...rest }: PressableProps & { title: string; tone?: "brand" | "green" | "plain" | "red"; style?: ViewStyle }) {
  const bg = tone === "brand" ? colors.brand : tone === "green" ? colors.green : tone === "red" ? colors.red : "white";
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: rest.disabled ? 0.45 : pressed ? 0.8 : 1 }, tone === "plain" && s.plain, style]}
    >
      <Text style={[s.btnText, tone === "plain" && { color: colors.ink }]}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { paddingVertical: 18, paddingHorizontal: 20, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  plain: { borderWidth: 1, borderColor: colors.line },
  btnText: { color: "white", fontSize: 20, fontWeight: "700" },
});
