// The shape every locale must implement exactly — en.ts and es.ts are both
// typed against this, so a key missing (or extra) in either fails `tsc
// --noEmit`, which is already a mandated pipeline gate. See
// docs/workflows/i18n/plan.md for why a typed dictionary instead of a
// framework: exactly two locales, no plural-grammar need beyond the
// hand-written ternaries already in the code.
//
// Scope boundary (plan.md Phase 1 vs Phase 3): this covers UI chrome only
// — buttons, headings, banners, short labels. Anything sourced from
// lib/dtc.ts's content (a fault code's title/meaning/causes/symptoms, the
// structural system/origin/subsystem names from decodeDtc(), the
// voltage-cluster note sentence from detectVoltageCluster()) stays English
// until Phase 3 — those are curated automotive content, not interface
// copy, and a wrong translation there is bad real-world advice, not a
// cosmetic miss. Grep for "Phase 3" in the components to find every
// deliberate boundary.
export type Dictionary = {
  common: {
    cancel: string;
    retry: string;
    close: string;
    copy: string;
    copied: string;
    save: string;
  };
  shell: {
    appName: string;
    demoData: string;
    demoDataTooltip: string;
    nav: {
      overview: string;
      live: string;
      history: string;
      diagnose: string;
      lab: string;
      vehicle: string;
    };
    status: {
      connected: string;
      connecting: string;
      disconnected: string;
      recording: string;
      linkUp: string;
      wakingDongle: string;
      ignitionThenConnect: string;
    };
    connect: string;
    disconnect: string;
    disconnecting: string;
    language: string;
  };
  diagnose: {
    title: string;
    console: {
      cardTitle: string;
      scan: string;
      scanning: string;
      clearCodes: string;
      noScanYet: string;
      clickToScan: string;
      milOn: (n: number) => string;
      milOff: string;
      clickCodeHint: string;
      noCodesOnScan: string;
      // Whole sentences, not fragments glued together — word order
      // differs across languages, so each locale owns the full sentence
      // rather than the component concatenating locale-specific pieces.
      clearedVerified: (before: number) => string;
      clearedButCameBack: (after: number) => string;
      resetNote: string;
      scanningPhrases: [string, string, string];
    };
    groups: {
      codeCount: (n: number) => string;
      showDetails: string;
      hideDetails: string;
      notInLibrary: string;
      voltageLinked: string;
      voltageLinkedTooltip: string;
      severity: { high: string; medium: string; low: string; unknown: string };
    };
    statusLabels: { stored: string; pending: string; permanent: string };
    detailsFor: (code: string) => string;
    historyMore: (n: number) => string;
    voltageClusterSuffix: string;
    freezeFrame: {
      title: string;
      causedBy: (code: string) => string;
    };
    readiness: {
      cardTitle: string;
      runScanToCheck: string;
      ready: string;
      notReady: string;
      allComplete: string;
      someIncomplete: string;
    };
    historyAndReports: {
      heading: string;
      subheading: string;
    };
    scanHistory: {
      cardTitle: string;
      couldNotLoad: string;
      noScansYet: string;
      clean: string;
    };
    detailModal: {
      notInLibrary: string;
      close: string;
      codeAnatomy: string;
      system: (value: string) => string;
      area: (value: string) => string;
      whenItHappened: string;
      notRecorded: string;
      commonCauses: string;
      typicalSymptoms: string;
      aiDeepDive: string;
      regenerateAiDeepDive: string;
      setApiKeyHint: string;
      generated: (date: string) => string;
      severity: { low: string; medium: string; high: string };
    };
    aiReport: {
      cardTitle: string;
      needsKeyExplainer: string;
      apiKeyPlaceholder: string;
      apiKeyAriaLabel: string;
      saveKey: string;
      changeKey: string;
      generateReport: string;
      regenerateReport: string;
      runScanFirst: string;
      sendsDataNote: string;
    };
    writeHistory: {
      cardTitle: string;
      couldNotLoad: string;
      noWritesYet: string;
      outcome: { cleared: string; faultsRemain: string; refused: string; failed: string };
      action: { clearDtcs: string };
      failedWith: (err: string) => string;
      failed: string;
      codesBeforeUnread: (before: number) => string;
      codesBeforeAfter: (before: number, after: number) => string;
    };
    confirmClear: {
      title: string;
      module: string;
      whatChanges: string;
      reversal: string;
      confirmLabel: string;
      busyLabel: string;
    };
  };
  confirmWrite: {
    canThisBeUndone: string;
    savedToHistory: string;
  };
};
