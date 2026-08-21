import type { Dictionary } from "./dictionary";

export const es: Dictionary = {
  common: {
    cancel: "Cancelar",
    retry: "Reintentar",
    close: "Cerrar",
    copy: "Copiar",
    copied: "Copiado",
    save: "Guardar",
  },
  shell: {
    appName: "Scainner",
    demoData: "Datos de demostración",
    demoDataTooltip: "No se detectó backend de Tauri: mostrando datos simulados para la vista previa de la interfaz",
    nav: {
      overview: "Resumen",
      live: "En vivo",
      history: "Historial",
      diagnose: "Diagnóstico",
      lab: "Laboratorio",
      vehicle: "Vehículo",
    },
    status: {
      connected: "Conectado",
      connecting: "Conectando…",
      disconnected: "Desconectado",
      recording: "Grabando",
      linkUp: "Enlace activo",
      wakingDongle: "Activando el dongle",
      ignitionThenConnect: "Contacto puesto, luego conectar",
    },
    connect: "Conectar",
    disconnect: "Desconectar",
    disconnecting: "Desconectando…",
    language: "Idioma",
  },
  diagnose: {
    title: "Diagnóstico",
    console: {
      cardTitle: "Códigos de avería",
      scan: "Escanear códigos",
      scanning: "Escaneando…",
      clearCodes: "Borrar códigos…",
      noScanYet: "Aún no hay ningún escaneo.",
      clickToScan: "Pulsa «Escanear códigos» para revisar este vehículo.",
      milOn: (n) => `TESTIGO DE AVERÍA ENCENDIDO · ${n} códigos`,
      milOff: "Testigo apagado",
      clickCodeHint: "Pulsa cualquier código para ver detalles, su historial y un análisis con IA.",
      noCodesOnScan: "Sin códigos en este escaneo.",
      clearedVerified: (before) =>
        `Borrado y verificado: ${before === 0 ? "sin códigos" : `${before} código${before === 1 ? "" : "s"}`} antes, ninguno restante.`,
      clearedButCameBack: (after) =>
        `Borrado, pero ${after} código${after === 1 ? "" : "s"} volvió${after === 1 ? "" : "n"} de inmediato. No ${
          after === 1 ? "es un resto" : "son restos"
        }: hay que revisarlo${after === 1 ? "" : "s"}, sigue${after === 1 ? "" : "n"} activo${after === 1 ? "" : "s"}.`,
      resetNote:
        "No hace falta un ciclo de contacto para que se apague el testigo de avería: se apaga con el borrado. Dos cosas se reinician con esto: los monitores de disponibilidad vuelven a completarse en los próximos trayectos (relevante antes de una inspección técnica o de emisiones, la ITV en España), y los códigos permanentes (si los hay) solo se borran solos cuando el coche verifica que la avería ya no está presente.",
      scanningPhrases: [
        "Leyendo códigos de avería…",
        "Comprobando monitores de disponibilidad…",
        "Extrayendo datos del fotograma de congelación…",
      ],
    },
    groups: {
      codeCount: (n) => `(${n} código${n === 1 ? "" : "s"})`,
      showDetails: "Mostrar detalles",
      hideDetails: "Ocultar detalles",
      notInLibrary: "No está en la biblioteca sin conexión",
      voltageLinked: "relacionado con voltaje",
      voltageLinkedTooltip: "Probablemente un efecto secundario del voltaje: mira la nota de arriba",
      severity: {
        high: "Gravedad alta",
        medium: "Gravedad media",
        low: "Gravedad baja",
        unknown: "No está en la biblioteca sin conexión",
      },
    },
    statusLabels: { stored: "Almacenado", pending: "Pendiente", permanent: "Permanente" },
    detailsFor: (code) => `Detalles de ${code}`,
    historyMore: (n) => `+${n} más`,
    voltageClusterSuffix: "Cada código se sigue mostrando por separado; pulsa cualquiera de ellos para ver los detalles.",
    freezeFrame: {
      title: "Fotograma de congelación",
      causedBy: (code) => `causado por ${code}`,
    },
    readiness: {
      cardTitle: "Monitores de disponibilidad",
      runScanToCheck: "Ejecuta un escaneo para comprobar los monitores de disponibilidad.",
      ready: "listo",
      notReady: "no listo",
      allComplete:
        "Todos los monitores están completos. Esto es lo que comprueba una inspección técnica o de emisiones (la ITV en España).",
      someIncomplete:
        "Algunos monitores están incompletos (normal después de borrar códigos o desconectar la batería; vuelven a completarse en varios trayectos).",
    },
    historyAndReports: {
      heading: "Historial e informes",
      subheading: "Escaneos y cambios anteriores, independientes del espacio de trabajo activo de arriba.",
    },
    scanHistory: {
      cardTitle: "Historial de escaneos",
      couldNotLoad: "No se pudo cargar el historial de escaneos.",
      noScansYet: "Aún no hay escaneos registrados. Ejecuta uno mientras estés conectado.",
      clean: "sin averías",
    },
    detailModal: {
      notInLibrary: "No está en la biblioteca integrada: descodificación estructural y análisis con IA a continuación",
      close: "Cerrar",
      codeAnatomy: "Anatomía del código",
      system: (value) => `Sistema: ${value}`,
      area: (value) => `Área: ${value}`,
      whenItHappened: "Cuándo ocurrió",
      notRecorded: "No aparece en ningún escaneo registrado (visto solo en vivo).",
      commonCauses: "Causas comunes (de más a menos probable)",
      typicalSymptoms: "Síntomas habituales",
      aiDeepDive: "Análisis con IA para este código",
      regenerateAiDeepDive: "Regenerar análisis con IA",
      setApiKeyHint: "Configura tu clave de API de Anthropic en la tarjeta de diagnóstico con IA de abajo para habilitar el análisis por código.",
      generated: (date) => `generado ${date}`,
      severity: { low: "urgencia baja", medium: "atención", high: "grave" },
    },
    aiReport: {
      cardTitle: "Diagnóstico con IA",
      needsKeyExplainer:
        "Analiza el historial de escaneos, los fotogramas de congelación y las tendencias de los sensores de arriba con Claude y redacta un informe de diagnóstico. Necesita tu propia clave de API de Anthropic: se guarda solo en este equipo y se usa solo al generar un informe.",
      apiKeyPlaceholder: "sk-ant-…",
      apiKeyAriaLabel: "Clave de API de Anthropic",
      saveKey: "Guardar clave",
      changeKey: "Cambiar clave…",
      generateReport: "Generar informe",
      regenerateReport: "Regenerar informe",
      runScanFirst: "Ejecuta al menos un escaneo primero: el informe analiza datos reales registrados.",
      sendsDataNote:
        "Al generar el informe se envía el resumen de diagnóstico de este coche (identidad, códigos, estadísticas de sensores) a la API de Anthropic.",
    },
    writeHistory: {
      cardTitle: "Historial de cambios",
      couldNotLoad: "No se pudo cargar el historial de cambios.",
      noWritesYet: "Aún no hay cambios registrados. Cada cambio que esta aplicación envía al coche aparece aquí, con el estado leído antes y después.",
      outcome: { cleared: "borrado", faultsRemain: "quedan averías", refused: "módulo rechazado", failed: "fallido" },
      action: { clearDtcs: "Borrado de códigos de avería" },
      failedWith: (err) => `fallido: ${err}`,
      failed: "fallido",
      codesBeforeUnread: (before) => `${before} código${before === 1 ? "" : "s"} antes, resultado no leído`,
      codesBeforeAfter: (before, after) => `${before} código${before === 1 ? "" : "s"} antes, ${after} después`,
    },
    confirmClear: {
      title: "¿Borrar los códigos de avería?",
      module: "Motor (OBD)",
      whatChanges:
        "Esto borra los códigos almacenados y pendientes, y reinicia los monitores de disponibilidad. Los códigos permanentes, si los hay, solo se borran solos cuando el coche verifica que la avería ya no está presente. El escaneo de arriba ya está guardado en el historial.",
      reversal:
        "No. Los códigos borrados no se pueden recuperar. Aun así es seguro hacerlo: los códigos siguen guardados en el historial de escaneos y en el historial de cambios de abajo, y una avería que siga presente volverá a reportarse por sí sola.",
      confirmLabel: "Sí, borrar",
      busyLabel: "Borrando…",
    },
  },
  confirmWrite: {
    canThisBeUndone: "¿Se puede deshacer esto?",
    savedToHistory: "El estado antes y después de este cambio se guarda en el historial de cambios.",
  },
};
