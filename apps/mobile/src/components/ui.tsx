// Small shared UI kit implementing the "calm instrument" system on React
// Native primitives: flat 1px-bordered cards, a single green accent,
// lucide icons at one stroke width, monospace + tabular numerals for every
// number. Mirrors the spirit of apps/desktop/src/components/ui.tsx.
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { colors, fontSize, icon, mono, radius, space, tints } from "../theme";

// ---------- Card ----------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CardTitle({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <View style={styles.cardTitleRow}>
      {Icon != null && <Icon size={icon.sm} strokeWidth={icon.strokeWidth} color={colors.foreground} />}
      <Text style={styles.cardTitleText}>{children}</Text>
    </View>
  );
}

// ---------- Text helpers ----------

/** Monospace + tabular-nums — for every sensor value, voltage, code, VIN. */
export function Mono({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.monoText, style]}>{children}</Text>;
}

export function MutedText({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.mutedText, style]}>{children}</Text>;
}

// ---------- Button ----------

type ButtonVariant = "primary" | "outline" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  icon: Icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  icon?: LucideIcon;
}) {
  const labelColor =
    variant === "primary" ? colors.primaryForeground : variant === "outline" ? colors.foreground : colors.mutedForeground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && { backgroundColor: colors.primary },
        variant === "outline" && { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
        pressed && { opacity: 0.75 },
        (disabled || busy) && { opacity: 0.45 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        Icon != null && <Icon size={icon.sm} strokeWidth={icon.strokeWidth} color={labelColor} />
      )}
      <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

// ---------- Status badge (DTC codes, MIL state) ----------

export type BadgeTone = "good" | "watch" | "attention" | "neutral";

const badgeTone: Record<BadgeTone, { bg: string; fg: string }> = {
  good: { bg: tints.primary, fg: colors.primary },
  watch: { bg: tints.warn, fg: colors.warn },
  attention: { bg: tints.destructive, fg: colors.destructive },
  neutral: { bg: tints.muted, fg: colors.mutedForeground },
};

export function Badge({ tone, monoLabel, children }: { tone: BadgeTone; monoLabel?: boolean; children: ReactNode }) {
  const t = badgeTone[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, monoLabel && mono, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

// ---------- Async states ----------

export function LoadingRow({ label }: { label: string }) {
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <MutedText>{label}</MutedText>
    </View>
  );
}

export function ErrorRow({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <View style={styles.errorCol}>
      <Text style={styles.errorText}>{message}</Text>
      <Button variant="outline" label={retryLabel} onPress={onRetry} />
    </View>
  );
}

export function EmptyState({ icon: Icon, title, explainer }: { icon: LucideIcon; title: string; explainer: string }) {
  return (
    <View style={styles.emptyCol}>
      <Icon size={icon.md} strokeWidth={icon.strokeWidth} color={colors.mutedForeground} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <MutedText style={styles.emptyExplainer}>{explainer}</MutedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space(4),
    gap: space(3),
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  cardTitleText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  monoText: {
    ...mono,
    fontSize: fontSize.sm,
    color: colors.foreground,
  },
  mutedText: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1.5),
    height: 40,
    paddingHorizontal: space(4),
    borderRadius: radius.md,
  },
  buttonLabel: {
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    paddingVertical: space(0.5),
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(2),
  },
  errorCol: {
    gap: space(2),
    alignItems: "flex-start",
    paddingVertical: space(1),
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
  },
  emptyCol: {
    alignItems: "flex-start",
    gap: space(2),
    paddingVertical: space(2),
  },
  emptyTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  emptyExplainer: {
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
});
