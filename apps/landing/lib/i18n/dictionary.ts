export type Dictionary = {
  nav: {
    download: string;
    getNotified: string;
  };
  hero: {
    eyebrow: string;
    heading: string;
    body: string;
    downloadMac: string;
    worksWithAdapter: string;
    comingSoon: string;
    emailPlaceholder: string;
    notifyMe: string;
    onTheList: string;
    oneEmail: string;
    orDownloadMac: string;
  };
  showcase: {
    heading: string;
    body: string;
    screenshotAlt: string;
    preview: {
      windowTitle: string;
      sidebarPrimary: string;
      sidebarAdvanced: string;
      nav: {
        overview: string;
        diagnose: string;
        live: string;
        workshop: string;
        lab: string;
        vehicle: string;
      };
      adapter: string;
      title: string;
      subtitle: string;
      rescan: string;
      clearCodes: string;
      meaningLabel: string;
      askSonda: string;
      freezeFrameLabel: string;
      freezeFrame: { label: string; value: string }[];
      primaryFault: { code: string; title: string; module: string; status: string; meaning: string };
      otherFaults: { code: string; title: string; module: string; status: string }[];
    };
    features: { title: string; body: string }[];
  };
  howItWorks: {
    kicker: string;
    heading: string;
    steps: { title: string; body: string }[];
  };
  connectors: {
    kicker: string;
    heading: string;
    body: string;
    list: string[];
    brandsRecognised: string;
  };
  comparison: {
    kicker: string;
    heading: string;
    body: string;
    genericReader: {
      label: string;
      code: string;
      title: string;
      rows: string[];
      footer: string;
    };
    sonda: {
      confirmed: string;
      code: string;
      title: string;
      whyHappened: string;
      causes: { label: string; pct: number }[];
      explanation: string;
      affects: { label: string; body: string };
      fix: { label: string; body: string };
      cost: { label: string; value: string };
      exportReport: string;
    };
    readToAnswer: string;
    readToAnswerTags: string[];
    payPerReport: string;
  };
  pricing: {
    kicker: string;
    heading: string;
    body: string;
    individuals: {
      title: string;
      tag: string;
      rows: string[];
    };
    shops: {
      title: string;
      tag: string;
      rows: string[];
    };
    downloadMac: string;
    notifyMe: string;
  };
  footer: {
    tagline: string;
    platforms: string;
    macAvailable: string;
    windowsSoon: string;
    iphoneSoon: string;
    androidSoon: string;
    copyright: string;
    switchTo: string;
  };
  platforms: {
    mac: string;
    windows: string;
    ios: string;
    android: string;
    other: string;
  };
};
