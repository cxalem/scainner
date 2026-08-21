// Email one-time-code sign-in — the exact auth shape the desktop app uses
// (apps/desktop/src/views/vehicle/AccountSyncCard.tsx): signInWithOtp sends
// the 6-digit code, verifyOtp exchanges it for a session. App.tsx listens
// to onAuthStateChange, so success here needs no navigation call.
import { Activity } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useT } from "../i18n";
import { supabase } from "../lib/supabase";
import { colors, fontSize, icon, mono, radius, space } from "../theme";
import { Button } from "../components/ui";

export function SignInScreen() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setAuthError(error.message);
    else setStep("code");
  };

  const verify = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setAuthError(error.message);
    // On success onAuthStateChange fires in App.tsx and this screen unmounts.
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandBlock}>
          <View style={styles.brandRow}>
            <Activity size={icon.md} strokeWidth={icon.strokeWidth} color={colors.primary} />
            <Text style={styles.appName}>{t.signIn.appName}</Text>
          </View>
          <Text style={styles.tagline}>{t.signIn.tagline}</Text>
        </View>

        <Text style={styles.explainer}>{t.signIn.explainer}</Text>

        {step === "email" ? (
          <View style={styles.formBlock}>
            <Text style={styles.label}>{t.signIn.emailLabel}</Text>
            <TextInput
              accessibilityLabel={t.signIn.emailLabel}
              style={styles.input}
              placeholder={t.signIn.emailPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <Button
              label={busy ? t.signIn.sendingCode : t.signIn.sendCode}
              busy={busy}
              disabled={!email.includes("@")}
              onPress={() => void sendCode()}
            />
          </View>
        ) : (
          <View style={styles.formBlock}>
            <Text style={styles.codeSent}>{t.signIn.codeSentTo(email.trim())}</Text>
            <Text style={styles.label}>{t.signIn.codeLabel}</Text>
            <TextInput
              accessibilityLabel={t.signIn.codeLabel}
              style={[styles.input, styles.codeInput]}
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              inputMode="numeric"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
            />
            <View style={styles.buttonRow}>
              <Button
                label={busy ? t.signIn.verifying : t.signIn.verify}
                busy={busy}
                disabled={code.length < 6}
                onPress={() => void verify()}
              />
              <Button
                variant="ghost"
                label={t.common.cancel}
                disabled={busy}
                onPress={() => {
                  setStep("email");
                  setCode("");
                  setAuthError(null);
                }}
              />
            </View>
          </View>
        )}

        {authError != null && <Text style={styles.errorText}>{authError}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: space(6),
    gap: space(5),
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: { gap: space(1) },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
  },
  appName: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.foreground,
  },
  tagline: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  explainer: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.mutedForeground,
  },
  formBlock: { gap: space(2) },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.foreground,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space(3),
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  codeInput: {
    ...mono,
    letterSpacing: 6,
  },
  codeSent: {
    fontSize: fontSize.sm,
    color: colors.mutedForeground,
  },
  buttonRow: {
    flexDirection: "row",
    gap: space(2),
    alignItems: "center",
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
  },
});
