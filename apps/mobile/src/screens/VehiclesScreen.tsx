// The signed-in home: every vehicle RLS grants this user, with its recorded
// session count. Identity rule matches the cloud schema's intent
// (schema_v2.sql): display_name when the owner named the car, else the VIN,
// else an "unnamed vehicle" fallback for pre-Mode-09 ECUs.
import { Car, CloudOff, LogOut } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { fetchVehicles, type VehicleListItem } from "../data/queries";
import { useLocale, useT } from "../i18n";
import { supabase } from "../lib/supabase";
import { colors, fontSize, icon, radius, space } from "../theme";
import { Card, EmptyState, ErrorRow, LoadingRow, Mono, MutedText } from "../components/ui";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; vehicles: VehicleListItem[] };

export function VehiclesScreen({
  userEmail,
  onOpenVehicle,
}: {
  userEmail: string;
  onOpenVehicle: (vehicle: VehicleListItem) => void;
}) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const vehicles = await fetchVehicles();
      setState({ phase: "ready", vehicles });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t.vehicles.title}</Text>
          <MutedText style={styles.signedInAs}>{t.vehicles.signedInAs(userEmail)}</MutedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.vehicles.languageToggleLabel}
          onPress={() => setLocale(locale === "en" ? "es" : "en")}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <Text style={styles.langLabel}>{locale === "en" ? "ES" : "EN"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.vehicles.signOut}
          onPress={() => void supabase.auth.signOut()}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
        >
          <LogOut size={icon.sm} strokeWidth={icon.strokeWidth} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {state.phase === "loading" && (
        <View style={styles.listContent}>
          <LoadingRow label={t.common.loading} />
        </View>
      )}

      {state.phase === "error" && (
        <View style={styles.listContent}>
          <ErrorRow message={t.vehicles.couldNotLoad} retryLabel={t.common.retry} onRetry={() => void load()} />
        </View>
      )}

      {state.phase === "ready" && (
        <FlatList
          data={state.vehicles}
          keyExtractor={(v) => v.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.mutedForeground} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <Card>
              <EmptyState icon={CloudOff} title={t.vehicles.emptyTitle} explainer={t.vehicles.emptyExplainer} />
            </Card>
          }
          renderItem={({ item }) => <VehicleRow vehicle={item} onPress={() => onOpenVehicle(item)} />}
        />
      )}
    </View>
  );
}

function VehicleRow({ vehicle, onPress }: { vehicle: VehicleListItem; onPress: () => void }) {
  const t = useT();
  const name = vehicle.displayName ?? vehicle.vin ?? t.vehicles.unnamedVehicle;
  // Make/model/year sub-line only when the cloud actually has them.
  const specParts = [vehicle.make, vehicle.model, vehicle.year != null ? String(vehicle.year) : null].filter(
    (p): p is string => p != null && p.length > 0,
  );
  // A VIN used as the title is already visible; only repeat it below when a
  // display name is the title.
  const showVinLine = vehicle.displayName != null && vehicle.vin != null;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.pressed]}>
      <Card>
        <View style={styles.rowTop}>
          <Car size={icon.md} strokeWidth={icon.strokeWidth} color={colors.primary} />
          {vehicle.displayName == null && vehicle.vin != null ? (
            <Mono style={styles.vehicleName}>{name}</Mono>
          ) : (
            <Text style={styles.vehicleName}>{name}</Text>
          )}
        </View>
        <View style={styles.rowDetails}>
          {specParts.length > 0 && <MutedText style={styles.detailText}>{specParts.join(" ")}</MutedText>}
          {showVinLine && (
            <View style={styles.vinRow}>
              <MutedText style={styles.detailText}>{t.vehicles.vinLabel}</MutedText>
              <Mono style={styles.vinText}>{vehicle.vin}</Mono>
            </View>
          )}
          <MutedText style={styles.detailText}>{t.vehicles.sessionCount(vehicle.connectionCount)}</MutedText>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(3),
    gap: space(2),
  },
  headerText: { flex: 1, gap: space(0.5) },
  title: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
  },
  signedInAs: { fontSize: fontSize.xs },
  headerAction: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: space(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  langLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  pressed: { opacity: 0.7 },
  listContent: {
    paddingHorizontal: space(5),
    paddingBottom: space(8),
  },
  separator: { height: space(3) },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
  },
  vehicleName: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    flexShrink: 1,
  },
  rowDetails: { gap: space(1) },
  detailText: { fontSize: fontSize.xs },
  vinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
  },
  vinText: { fontSize: fontSize.xs, color: colors.mutedForeground },
});
