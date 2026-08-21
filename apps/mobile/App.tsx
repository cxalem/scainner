// Scainner mobile v1: a read-only companion viewer for the cloud record the
// desktop app syncs up. Three screens (sign-in → vehicles → vehicle detail)
// with plain state-based navigation — no router dependency for a linear
// three-screen flow, and v1 has no deep-linking need.
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LoadingRow } from "./src/components/ui";
import type { VehicleListItem } from "./src/data/queries";
import { I18nProvider, useT } from "./src/i18n";
import { supabase } from "./src/lib/supabase";
import { SignInScreen } from "./src/screens/SignInScreen";
import { VehicleDetailScreen } from "./src/screens/VehicleDetailScreen";
import { VehiclesScreen } from "./src/screens/VehiclesScreen";
import { colors } from "./src/theme";

// "checking" covers the async AsyncStorage session restore on cold start —
// without it the sign-in form would flash for already-signed-in users.
type AuthState = { phase: "checking" } | { phase: "signedOut" } | { phase: "signedIn"; email: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <Root />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useT();
  const [auth, setAuth] = useState<AuthState>({ phase: "checking" });
  const [openVehicle, setOpenVehicle] = useState<VehicleListItem | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user.email;
      setAuth(email != null ? { phase: "signedIn", email } : { phase: "signedOut" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user.email;
      setAuth(email != null ? { phase: "signedIn", email } : { phase: "signedOut" });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Signing out (or a session expiring) also closes any open detail screen.
  useEffect(() => {
    if (auth.phase !== "signedIn") setOpenVehicle(null);
  }, [auth.phase]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom", "left", "right"]}>
      <StatusBar style="dark" />
      {auth.phase === "checking" && (
        <View style={styles.checking}>
          <LoadingRow label={t.common.loading} />
        </View>
      )}
      {auth.phase === "signedOut" && <SignInScreen />}
      {auth.phase === "signedIn" &&
        (openVehicle != null ? (
          <VehicleDetailScreen vehicle={openVehicle} onBack={() => setOpenVehicle(null)} />
        ) : (
          <VehiclesScreen userEmail={auth.email} onOpenVehicle={setOpenVehicle} />
        ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  checking: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
