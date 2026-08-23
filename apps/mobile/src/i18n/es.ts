import type { Dictionary } from "./dictionary";

export const es: Dictionary = {
  common: {
    cancel: "Cancelar",
    retry: "Reintentar",
    back: "Atrás",
    loading: "Cargando…",
  },
  signIn: {
    appName: "Scainner",
    tagline: "El historial de salud de tus coches, en tu móvil",
    explainer:
      "Inicia sesión con un código de un solo uso que llega a tu correo, sin contraseña. Verás los vehículos y los datos grabados que la app de escritorio de Scainner ha respaldado en tu cuenta.",
    emailLabel: "Correo",
    emailPlaceholder: "tu@ejemplo.com",
    sendCode: "Enviar código",
    sendingCode: "Enviando…",
    codeSentTo: (email) => `Hemos enviado un código de 6 dígitos a ${email}.`,
    codeLabel: "Código de un solo uso",
    verify: "Iniciar sesión",
    verifying: "Iniciando sesión…",
    preview: "Explorar con datos de demostración (sin cuenta)",
    previewBadge: "Datos de demostración",
  },
  vehicles: {
    title: "Vehículos",
    signedInAs: (email) => `Sesión iniciada como ${email}`,
    signOut: "Cerrar sesión",
    unnamedVehicle: "Vehículo sin nombre",
    vinLabel: "VIN",
    sessionCount: (n) => (n === 1 ? "1 sesión grabada" : `${n} sesiones grabadas`),
    couldNotLoad: "No se pudieron cargar tus vehículos.",
    emptyTitle: "Todavía no hay vehículos",
    emptyExplainer:
      "Los vehículos aparecen aquí cuando la app de escritorio de Scainner se conecta a un coche y sincroniza sus datos grabados con esta cuenta.",
    languageToggleLabel: "Idioma",
  },
  vehicle: {
    fallbackTitle: "Vehículo",
    statsCardTitle: "Lecturas clave",
    last7Days: "Últimos 7 días",
    latest: "Última",
    min: "Mín",
    avg: "Media",
    max: "Máx",
    samples: (n) => (n === 1 ? "1 muestra" : `${n} muestras`),
    noReadingsTitle: "Sin lecturas en los últimos 7 días",
    noReadingsExplainer:
      "Las lecturas aparecen cuando se graba un trayecto en la app de escritorio y se sincroniza con esta cuenta.",
    couldNotLoadStats: "No se pudieron cargar las lecturas.",
    sensors: {
      coolant: "Temp. refrigerante",
      voltage: "Voltaje de batería",
      rpm: "Régimen del motor",
      speed: "Velocidad",
    },
    scansCardTitle: "Historial de escaneos",
    noScansTitle: "Todavía no hay escaneos",
    noScansExplainer:
      "Los escaneos de códigos de avería hechos desde la app de escritorio aparecen aquí cuando se sincronizan.",
    couldNotLoadScans: "No se pudo cargar el historial de escaneos.",
    milOn: "Testigo de motor encendido",
    clean: "Sin averías",
    batteryAtScan: (volts) => `Batería durante el escaneo: ${volts} V`,
    codeStatus: {
      stored: "almacenado",
      pending: "pendiente",
      permanent: "permanente",
    },
  },
};
