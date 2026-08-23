// The shape every locale must implement exactly — en.ts and es.ts are both
// typed against this, so a key missing (or extra) in either fails
// `tsc --noEmit`. Same typed-dictionary pattern as the desktop app
// (apps/desktop/src/i18n/dictionary.ts), but a separate, mobile-scoped
// dictionary: desktop's keys are desktop-specific (Lab, Live, updater…) and
// importing them here would force every locale to carry copy this app
// never renders.
export type Dictionary = {
  common: {
    cancel: string;
    retry: string;
    back: string;
    loading: string;
  };
  signIn: {
    appName: string;
    tagline: string;
    explainer: string;
    emailLabel: string;
    emailPlaceholder: string;
    sendCode: string;
    sendingCode: string;
    codeSentTo: (email: string) => string;
    codeLabel: string;
    verify: string;
    verifying: string;
    preview: string;
    previewBadge: string;
  };
  vehicles: {
    title: string;
    signedInAs: (email: string) => string;
    signOut: string;
    unnamedVehicle: string;
    vinLabel: string;
    // Whole sentence per count — each locale owns its own plural ternary.
    sessionCount: (n: number) => string;
    couldNotLoad: string;
    emptyTitle: string;
    emptyExplainer: string;
    languageToggleLabel: string;
  };
  vehicle: {
    fallbackTitle: string;
    statsCardTitle: string;
    last7Days: string;
    latest: string;
    min: string;
    avg: string;
    max: string;
    samples: (n: number) => string;
    noReadingsTitle: string;
    noReadingsExplainer: string;
    couldNotLoadStats: string;
    sensors: {
      coolant: string;
      voltage: string;
      rpm: string;
      speed: string;
    };
    scansCardTitle: string;
    noScansTitle: string;
    noScansExplainer: string;
    couldNotLoadScans: string;
    milOn: string;
    clean: string;
    batteryAtScan: (volts: string) => string;
    codeStatus: {
      stored: string;
      pending: string;
      permanent: string;
    };
  };
};
