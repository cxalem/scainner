// One vehicle's cloud record: key sensor stats over the last 7 days
// (computed client-side from a bounded readings query) and the fault-scan
// history with its code badges. Read-only — the desktop app is the writer.
import { ArrowLeft, FileClock, Gauge } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  fetchScanHistory,
  fetchSensorStats,
  type ScanEvent,
  type SensorStats,
  type StatKey,
  type VehicleListItem,
} from "../data/queries";
import { useLocale, useT } from "../i18n";
import { colors, fontSize, icon, radius, space } from "../theme";
import { Badge, Card, CardTitle, EmptyState, ErrorRow, LoadingRow, Mono, MutedText, type BadgeTone } from "../components/ui";

// Display formatting per sensor key: unit and decimal places. Voltage keeps
// a decimal (12.4 V is meaningful); the rest read best as integers.
const SENSOR_FORMAT: Record<StatKey, { unit: string; decimals: number }> = {
  coolant: { unit: "°C", decimals: 0 },
  voltage: { unit: "V", decimals: 1 },
  rpm: { unit: "rpm", decimals: 0 },
  speed: { unit: "km/h", decimals: 0 },
};

function formatValue(key: StatKey, value: number): string {
  return value.toFixed(SENSOR_FORMAT[key].decimals);
}

type Async<T> = { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: T };

export function VehicleDetailScreen({ vehicle, onBack }: { vehicle: VehicleListItem; onBack: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [stats, setStats] = useState<Async<SensorStats[]>>({ phase: "loading" });
  const [scans, setScans] = useState<Async<ScanEvent[]>>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setStats({ phase: "ready", data: await fetchSensorStats(vehicle.id) });
    } catch {
      setStats({ phase: "error" });
    }
  }, [vehicle.id]);

  const loadScans = useCallback(async () => {
    try {
      setScans({ phase: "ready", data: await fetchScanHistory(vehicle.id) });
    } catch {
      setScans({ phase: "error" });
    }
  }, [vehicle.id]);

  useEffect(() => {
    void loadStats();
    void loadScans();
  }, [loadStats, loadScans]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadScans()]);
    setRefreshing(false);
  };

  const title = vehicle.displayName ?? vehicle.vin ?? t.vehicle.fallbackTitle;
  const titleIsVin = vehicle.displayName == null && vehicle.vin != null;
  const dateLocale = locale === "es" ? "es-ES" : "en-US";

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ArrowLeft size={icon.md} strokeWidth={icon.strokeWidth} color={colors.foreground} />
        </Pressable>
        {titleIsVin ? (
          <Mono style={styles.title}>{title}</Mono>
        ) : (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.mutedForeground} />}
      >
        <Card>
          <View style={styles.cardHeaderRow}>
            <CardTitle icon={Gauge}>{t.vehicle.statsCardTitle}</CardTitle>
            <MutedText style={styles.windowLabel}>{t.vehicle.last7Days}</MutedText>
          </View>
          {stats.phase === "loading" && <LoadingRow label={t.common.loading} />}
          {stats.phase === "error" && (
            <ErrorRow message={t.vehicle.couldNotLoadStats} retryLabel={t.common.retry} onRetry={() => void loadStats()} />
          )}
          {stats.phase === "ready" &&
            (stats.data.length === 0 ? (
              <EmptyState icon={Gauge} title={t.vehicle.noReadingsTitle} explainer={t.vehicle.noReadingsExplainer} />
            ) : (
              <View style={styles.statList}>
                {stats.data.map((s) => (
                  <SensorRow key={s.key} stats={s} />
                ))}
              </View>
            ))}
        </Card>

        <Card>
          <CardTitle icon={FileClock}>{t.vehicle.scansCardTitle}</CardTitle>
          {scans.phase === "loading" && <LoadingRow label={t.common.loading} />}
          {scans.phase === "error" && (
            <ErrorRow message={t.vehicle.couldNotLoadScans} retryLabel={t.common.retry} onRetry={() => void loadScans()} />
          )}
          {scans.phase === "ready" &&
            (scans.data.length === 0 ? (
              <EmptyState icon={FileClock} title={t.vehicle.noScansTitle} explainer={t.vehicle.noScansExplainer} />
            ) : (
              <View style={styles.scanList}>
                {scans.data.map((scan, i) => (
                  <View key={scan.id} style={[styles.scanRow, i > 0 && styles.scanRowBorder]}>
                    <View style={styles.scanTopRow}>
                      <Mono style={styles.scanDate}>
                        {new Date(scan.ts).toLocaleString(dateLocale, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Mono>
                      {scan.milOn ? (
                        <Badge tone="attention">{t.vehicle.milOn}</Badge>
                      ) : (
                        scan.codes.length === 0 && <Badge tone="good">{t.vehicle.clean}</Badge>
                      )}
                    </View>
                    {scan.codes.length > 0 && (
                      <View style={styles.codeWrap}>
                        {scan.codes.map((c) => (
                          <Badge key={`${c.code}-${c.status}`} tone={codeTone(c.status)} monoLabel>
                            {c.code} · {t.vehicle.codeStatus[c.status]}
                          </Badge>
                        ))}
                      </View>
                    )}
                    {scan.voltage != null && (
                      <MutedText style={styles.scanVoltage}>{t.vehicle.batteryAtScan(scan.voltage.toFixed(1))}</MutedText>
                    )}
                  </View>
                ))}
              </View>
            ))}
        </Card>
      </ScrollView>
    </View>
  );
}

function codeTone(status: ScanEvent["codes"][number]["status"]): BadgeTone {
  // Semantic colors carry meaning: a stored/permanent code is an attention
  // state, a pending code is a watch state.
  return status === "pending" ? "watch" : "attention";
}

function SensorRow({ stats }: { stats: SensorStats }) {
  const t = useT();
  const { unit } = SENSOR_FORMAT[stats.key];
  return (
    <View style={styles.sensorRow}>
      <View style={styles.sensorHeadRow}>
        <Text style={styles.sensorLabel}>{t.vehicle.sensors[stats.key]}</Text>
        <View style={styles.latestRow}>
          <Mono style={styles.latestValue}>{formatValue(stats.key, stats.latest)}</Mono>
          <MutedText style={styles.unitText}>{unit}</MutedText>
        </View>
      </View>
      <View style={styles.rangeRow}>
        <RangeCell label={t.vehicle.min} value={formatValue(stats.key, stats.min)} />
        <RangeCell label={t.vehicle.avg} value={formatValue(stats.key, stats.avg)} />
        <RangeCell label={t.vehicle.max} value={formatValue(stats.key, stats.max)} />
        <MutedText style={styles.samplesText}>{t.vehicle.samples(stats.samples)}</MutedText>
      </View>
    </View>
  );
}

function RangeCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rangeCell}>
      <MutedText style={styles.rangeLabel}>{label}</MutedText>
      <Mono style={styles.rangeValue}>{value}</Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingHorizontal: space(5),
    paddingTop: space(3),
    paddingBottom: space(3),
  },
  backButton: {
    height: 36,
    width: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  title: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: space(5),
    paddingBottom: space(8),
    gap: space(3),
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  windowLabel: { fontSize: fontSize.xs },
  statList: { gap: space(4) },
  sensorRow: { gap: space(1.5) },
  sensorHeadRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space(2),
  },
  sensorLabel: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    flexShrink: 1,
  },
  latestRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space(1),
  },
  latestValue: {
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  unitText: { fontSize: fontSize.xs },
  rangeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space(4),
  },
  rangeCell: { gap: space(0.5) },
  rangeLabel: { fontSize: fontSize.xs },
  rangeValue: { fontSize: fontSize.xs, color: colors.mutedForeground },
  samplesText: {
    fontSize: fontSize.xs,
    marginLeft: "auto",
  },
  scanList: { gap: space(3) },
  scanRow: { gap: space(2) },
  scanRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space(3),
  },
  scanTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(2),
  },
  scanDate: { fontSize: fontSize.xs, color: colors.mutedForeground },
  codeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space(1.5),
  },
  scanVoltage: { fontSize: fontSize.xs },
});
