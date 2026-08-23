import type { Dictionary } from "./dictionary";

export const en: Dictionary = {
  common: {
    cancel: "Cancel",
    retry: "Retry",
    back: "Back",
    loading: "Loading…",
  },
  signIn: {
    appName: "Scainner",
    tagline: "Your cars' health record, on your phone",
    explainer:
      "Sign in with a one-time code from your email — no password. You'll see the vehicles and recorded data that the Scainner desktop app has backed up to your account.",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    sendCode: "Send code",
    sendingCode: "Sending…",
    codeSentTo: (email) => `We emailed a 6-digit code to ${email}.`,
    codeLabel: "One-time code",
    verify: "Sign in",
    verifying: "Signing in…",
    preview: "Browse with demo data (no account)",
    previewBadge: "Demo data",
  },
  vehicles: {
    title: "Vehicles",
    signedInAs: (email) => `Signed in as ${email}`,
    signOut: "Sign out",
    unnamedVehicle: "Unnamed vehicle",
    vinLabel: "VIN",
    sessionCount: (n) => (n === 1 ? "1 recorded session" : `${n} recorded sessions`),
    couldNotLoad: "Could not load your vehicles.",
    emptyTitle: "No vehicles yet",
    emptyExplainer:
      "Vehicles appear here after the Scainner desktop app connects to a car and syncs its recorded data to this account.",
    languageToggleLabel: "Language",
  },
  vehicle: {
    fallbackTitle: "Vehicle",
    statsCardTitle: "Key readings",
    last7Days: "Last 7 days",
    latest: "Latest",
    min: "Min",
    avg: "Avg",
    max: "Max",
    samples: (n) => (n === 1 ? "1 sample" : `${n} samples`),
    noReadingsTitle: "No readings in the last 7 days",
    noReadingsExplainer:
      "Readings appear after a drive is recorded on the desktop app and synced to this account.",
    couldNotLoadStats: "Could not load readings.",
    sensors: {
      coolant: "Coolant temp",
      voltage: "Battery voltage",
      rpm: "Engine RPM",
      speed: "Vehicle speed",
    },
    scansCardTitle: "Scan history",
    noScansTitle: "No fault scans yet",
    noScansExplainer:
      "Fault-code scans run from the desktop app show up here once they sync.",
    couldNotLoadScans: "Could not load scan history.",
    milOn: "Check-engine light on",
    clean: "Clean",
    batteryAtScan: (volts) => `Battery at scan: ${volts} V`,
    codeStatus: {
      stored: "stored",
      pending: "pending",
      permanent: "permanent",
    },
  },
};
