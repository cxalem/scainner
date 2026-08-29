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
    copying: string;
    save: string;
  };
  shell: {
    appName: string;
    demoData: string;
    cloudSignInPrompt: string;
    demoDataTooltip: string;
    // Sidebar nav group labels and the vehicle switcher's status lines.
    navGroups: { primary: string; advanced: string };
    switcher: {
      onCable: string;
      fromDatabase: string;
      notConnected: string;
      connectedNote: string;
      storedNote: string;
    };
    signOut: string;
    adapterFallback: string;
    nav: {
      workshop: string;
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
    // App-wide vehicle switcher (multi-brand plan P4.5): shown when the
    // database holds more than one vehicle or nothing is connected.
    vehicleSwitcher: {
      label: string;
      connectedSuffix: string;
      unnamed: (id: number) => string;
    };
    // Shown while a car is connected but another vehicle is being browsed:
    // every view is an archive then, live controls are off.
    archive: {
      browsing: (name: string) => string;
      returnToConnected: string;
    };
  };
  workshop: {
    title: string;
    subtitle: string;
    newCase: string;
    intake: string;
    vehicle: string;
    selectVehicle: string;
    technician: string;
    optional: string;
    complaint: string;
    complaintPlaceholder: string;
    odometer: string;
    creating: string;
    createCase: string;
    loadError: string;
    createError: string;
    emptyTitle: string;
    emptyBody: string;
    unknownVehicle: (id: number) => string;
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
    unknownVehicle: string;
    unknownVehicleExplainer: string;
    // The "name this car" flow: a VIN-less vehicle (pre-Mode-09 ECU) gets
    // its identity from the user instead — see data-core plan.md.
    nameVehicleLabel: string;
    nameVehiclePlaceholder: string;
    nameVehicleAction: string;
    namingVehicle: string;
    nameVehicleFailed: string;
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
  lab: {
    discovery: {
      cardTitle: string;
      explainer: string;
      needsVehicle: string;
      start: string;
      running: string;
      phases: { modules: string; ident: string; sweep: string; done: string };
      foundSoFar: (modules: number, dids: number) => string;
      doneSummary: (modules: number, dids: number, sensorsAdded: number) => string;
      refreshedSummary: (modules: number, dids: number, sensorsAdded: number) => string;
      cancelledSummary: (modules: number, dids: number) => string;
      engineStartedSummary: (modules: number, dids: number) => string;
      coverageSummary: (
        attempted: number,
        total: number,
        reached: number,
        refused: number,
        timedOut: number,
        failed: number,
        skipped: number,
      ) => string;
      engineWarning: string;
      fullRescanToggle: string;
      previousFindings: string;
      unnamedModule: string;
      didCount: (total: number, labeled: number) => string;
      fingerprintSummary: (answered: number, total: number) => string;
      fingerprintExperimentTitle: string;
      fingerprintExperimentProgress: (
        scanned: number,
        target: number,
        fingerprinted: number,
        repeatedFamilies: number,
      ) => string;
      fingerprintExperimentCopy: string;
      fingerprintExperimentCopied: string;
    };
    advanced: {
      title: string;
      explainer: string;
    };
    title: string;
    moduleAriaLabel: string;
    customSuffix: string;
    explainer: string;
    didReader: {
      cardTitle: string;
      didAriaLabel: string;
      reading: string;
      read: string;
      noAnswer: string;
    };
    moduleFaults: {
      cardTitle: string;
      explainerBefore: string;
      explainerAfter: string;
      reading: string;
      readFaults: string;
      clearing: string;
      clearFaults: (n: number) => string;
      noFaultsStored: string;
      confirm: {
        title: string;
        whatChanges: string;
        reversal: string;
        confirmLabel: string;
      };
      refused: string;
      clearedVerified: (before: number) => string;
      clearedButCameBack: (before: number, after: number) => string;
      was: (codes: string) => string;
      stillPresent: (codes: string) => string;
      dashboardLightNote: string;
    };
    moduleManager: {
      cardTitle: string;
      addModule: string;
      couldNotLoad: string;
      builtin: string;
      custom: string;
      addExplainer: string;
      fieldName: string;
      fieldNamePlaceholder: string;
      fieldKey: string;
      fieldReq: string;
      fieldResp: string;
      saving: string;
      save: string;
      removing: string;
      remove: string;
    };
    probeManager: {
      newProbeTitle: (did: string, module: string) => string;
      saving: string;
      saveProbe: string;
      recordedCardTitle: string;
      couldNotLoad: string;
      noneYet: string;
      disable: string;
      enable: string;
      delete: string;
    };
    rangeScanner: {
      cardTitle: string;
      fromAriaLabel: string;
      toAriaLabel: string;
      to: string;
      scanning: string;
      scanningWithCount: (n: number) => string;
      scan: string;
      scanningChunk: (from: string, to: string, hitsSoFar: number) => string;
      scanDone: (n: number) => string;
      engineStarted: (did: string, hitsSoFar: number) => string;
      checkingProgress: (did: string, current: number, total: number) => string;
      noAnswersYetNote: string;
      probeAction: string;
    };
    parkedVerification: {
      cardTitle: string;
      beforeStarting: string;
      step1: string;
      step2: string;
      step3: (targets: number, identityReads: number, sweepReads: number) => string;
      readOnly: string;
      running: string;
      run: string;
      connectToRun: string;
      nameFirst: string;
      savedAs: (runId: string, plan: string) => string;
      answered: (answered: number, total: number) => string;
      expected: (family: string) => string;
      thDid: string;
      thPurpose: string;
      thResult: string;
      thEvidence: string;
      refused: (nrc: string) => string;
    };
    guidedCorrelation: {
      cardTitle: string;
      explainer: (repeats: number) => string;
      moduleLabel: string;
      identifiersPerCapture: (n: number) => string;
      connectToStart: string;
      nameFirst: string;
      noSteps: string;
      stepOf: (index: number, total: number) => string;
      baselineTitle: string;
      baselineInstruction: string;
      optional: string;
      preconditionStationary: string;
      preconditionMoves: string;
      preconditionEngine: (state: string) => string;
      confirmPrompt: string;
      confirmYes: string;
      reading: (n: number, repeats: number) => string;
      capture: (condition: string) => string;
      skip: string;
      skipOptional: string;
      restart: string;
      complete: (captures: number, plan: string) => string;
      newSession: string;
      lastCapture: (condition: string, runId: string, stable: number, total: number, repeats: number) => string;
      candidates: string;
      thCondition: string;
      thDid: string;
      thBaseline: string;
      thDuring: string;
      thReturned: string;
      thThisStep: string;
      thVerdict: string;
      yes: string;
      notYet: string;
      candidateNote: string;
      diffSummary: (condition: string, changed: number, noisy: number) => string;
      references: string;
      reference: string;
      referenceUnreachable: string;
      verdict: { changed: string; stable: string; noisy: string; missing: string };
    };
  };
  vehicle: {
    title: string;
    identity: {
      cardTitle: string;
      couldNotLoad: string;
      nothingReadYet: string;
      reading: string;
      readFromEcu: string;
    };
    map: {
      cardTitle: string;
      explainer: string;
      noVehicle: string;
      noModules: string;
      moduleCount: (count: number) => string;
      unknownModule: string;
      previouslyReached: string;
      identity: (answered: number, total: number) => string;
      values: (count: number) => string;
      firstSeen: string;
      lastSeen: string;
      nameSource: { ecu: string; identity: string; documented: string };
      moduleFaultsNotScanned: string;
      standardFaults: string;
      noStandardScan: string;
      standardFaultCount: (count: number) => string;
      raw: string;
    };
    data: {
      cardTitle: string;
      storedLocally: string;
      couldNotReadDbPath: string;
      copyAiBriefing: string;
      copiedAiBriefing: string;
      copyRawJson24h: string;
      copyRawJson30d: string;
      briefingExplainer: string;
    };
    account: {
      cardTitle: string;
      explainer: string;
      emailLabel: string;
      emailPlaceholder: string;
      sendCode: string;
      sendingCode: string;
      codeSentTo: (email: string) => string;
      codeLabel: string;
      verify: string;
      verifying: string;
      signedInAs: (email: string) => string;
      syncNow: string;
      syncing: string;
      lastSync: (time: string) => string;
      neverSynced: string;
      syncErrorLabel: string;
      signOut: string;
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
    scanningTitle: string;
    scanningExplainer: string;
    recordingNote: string;
    discoveredSensors: string;
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
  // Page heads: kicker / title / one-line lede per view.
  pages: Record<"overview" | "diagnose" | "live" | "workshop" | "lab" | "vehicle", { kicker: string; title: string; lede: (app: string) => string }>;
  // A1 — sign-in gate.
  login: {
    headline: string;
    sub: (brands: number) => string;
    signIn: string;
    signInSub: string;
    emailLabel: string;
    emailPlaceholder: string;
    sendLink: string;
    sending: string;
    codeLabel: string;
    verify: string;
    verifying: string;
    checkInbox: string;
    sentTo: (email: string) => string;
    codeHint: string;
    useAnother: string;
    resend: string;
    continueOffline: string;
    localNote: (app: string) => string;
    shareNote: string;
  };
  // A2 — connect gate.
  gate: {
    plugIn: string;
    plugInBody: (app: string) => string;
    reading: string;
    readingBody: string;
    recognised: (brand: string) => string;
    recognisedBody: (brand: string) => string;
    noAdapter: string;
    plugToBegin: string;
    readingVin: string;
    brandUnknownYet: string;
    connect: string;
    connecting: string;
    browseOffline: string;
    lines: { lookingForAdapter: string; wakingBus: string; vinRead: (vin: string) => string; recognisedFrom: (brand: string, wmi: string) => string; adapterFound: (v: string) => string };
  };
  updater: {
    available: (version: string) => string;
    install: string;
    installing: string;
    failed: string;
  };
};
