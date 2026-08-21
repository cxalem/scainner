// The shape every locale must implement exactly — en.ts and es.ts are both
// typed against this, so a key missing (or extra) in either fails `tsc
// --noEmit`, which is already a mandated pipeline gate. See
// docs/workflows/i18n/plan.md for why a typed dictionary instead of a
// framework: exactly two locales, no plural-grammar need beyond the
// hand-written ternaries already in the code.
//
// This covers UI chrome — buttons, headings, banners, short labels.
// DTC content (a fault code's title/meaning/causes/symptoms, the
// structural system/origin/subsystem names, sensor/monitor labels) is
// translated separately, in lib/dtc-codes.es.ts and
// shared/domain/gauges.es.ts — that's curated automotive content, not
// interface copy, so it gets its own locale-keyed data files (same
// key-safety pattern as this dictionary) instead of living in here.
// Content translated there is an AI-assisted first draft; per
// docs/workflows/i18n/plan.md it still wants a native-speaker review pass
// on the automotive terminology before it's fully trusted, same caution
// as any technical translation, not a defect specific to this app.
//
// The one thing still deliberately untranslated: detectVoltageCluster()'s
// generated note sentence (lib/dtc-grouping.ts) — its exact English text
// is asserted by dtc-grouping.test.ts, so translating it needs the same
// display-layer-only treatment as decodeDtc's strings, not done yet.
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
    // Shared by Shell's own Connect button and ConnectGate (the pre-first-
    // connect screen) — same cycling label, two call sites.
    connectPhrases: [string, string];
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
      noFaultCodesTitle: string;
      noFaultCodesExplainer: string;
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
  overview: {
    title: string;
    carAriaLabel: string;
    carOption: (vin: string, sessions: number) => string;
    couldNotLoadCars: string;
    noDataYet: string;
    noDataYetExplainer: string;
    couldNotLoadReport: string;
    stats: { sessions: string; engineTime: string; readings: string; scansClean: string };
    health: {
      cardTitle: string;
      statusGood: string;
      statusWatch: string;
      statusBad: string;
      notEnoughData: string;
      faultRecordTitle: string;
      faultRecordClean: (total: number) => string;
      faultRecordSome: (withCodes: number, total: number) => string;
      engineHealthTitle: string;
      engineHealthGood: (ltft: string) => string;
      engineHealthWatch: (ltft: string) => string;
      engineHealthBad: (ltft: string) => string;
      coolingTitle: string;
      coolingNeverReached: (maxTemp: string) => string;
      coolingOverheating: (maxTemp: string) => string;
      coolingGood: (maxTemp: string) => string;
      batteryTitle: string;
      batteryLow: (minVoltage: string) => string;
      batteryGood: (minVoltage: string, avgVoltage: string) => string;
      turboTitle: string;
      turboFull: (bar: string) => string;
      turboLight: (bar: string) => string;
    };
    battery: {
      cardTitle: string;
      noData: string;
    };
    fuel: {
      cardTitle: string;
      cardTitleWithRange: (range: string) => string;
      allTime: string;
      lastNDays: (n: number) => string;
      noData: string;
      noGaugeExplainer: string;
      consumption: string;
      costPer100km: string;
      fuelUsed: string;
      distance: string;
      noConsumptionYet: string;
      priceLabel: string;
      saving: string;
      saved: string;
      save: string;
      saveFailed: string;
      invalidPrice: string;
      estimateNote: string;
      tankAriaLabel: (pct: string, status: string) => string;
      status: { reserve: string; low: string; full: string; good: string };
    };
  };
  discoveryFlow: {
    newVehicle: string;
    step: {
      discoveringTitle: string;
      discoveringSubtitle: string;
      scanningTitle: string;
      scanningSubtitle: string;
      resultsTitle: string;
      resultsSubtitle: string;
    };
    readingAriaLabel: string;
    row: {
      vehicle: string;
      unrecognizedBrand: string;
      vin: string;
      protocol: string;
      elmVersion: string;
      sensorsFound: string;
      faultCodes: string;
      faultCodesClean: string;
      faultCodesFound: (n: number) => string;
    };
    goToDashboard: string;
  };
  live: {
    title: string;
    modeGauges: string;
    modeAllSensors: string;
    notConnectedTitle: string;
    notConnectedExplainer: string;
    recordingNote: string;
    allSensors: {
      readButton: string;
      readingPhrases: [string, string];
      filterAriaLabel: string;
      filterPlaceholder: string;
      readAt: (time: string, count: number) => string;
      emptyTitle: string;
      emptyExplainer: string;
      pid: string;
      sensor: string;
      value: string;
    };
  };
  history: {
    title: string;
    trend: {
      sensorAriaLabel: string;
      loading: string;
      samples: (n: number) => string;
      couldNotLoad: string;
      noDataForRange: string;
      voltageReferenceNote: string;
    };
    sensorRanges: {
      cardTitle: string;
      last7Days: string;
      allTime: string;
      noDataYet: string;
      sensor: string;
      min: string;
      avg: string;
      max: string;
      samples: string;
    };
    sessions: {
      cardTitle: string;
      cardTitleWithCount: (n: number) => string;
      noSessionsYet: string;
      startedUtc: string;
      duration: string;
      maxSpeed: string;
      maxCoolant: string;
      minVolts: string;
      readings: string;
    };
  };
};
