import type { Dictionary } from "./dictionary";

// Terminology matches the desktop app's own es.ts (apps/desktop/src/i18n/
// es.ts) where the same concept appears — "código de avería" for fault
// code, "escanear/escaneo" for scan, "testigo" for the check-engine light,
// "borrar" for clear — so a Spanish-speaking visitor who downloads the app
// doesn't land in a second, differently-worded vocabulary.
export const es: Dictionary = {
  nav: {
    download: "Descargar",
    getNotified: "Avísame",
  },
  hero: {
    eyebrow: "Habla con tu coche. Tu coche te responde.",
    heading: "Diagnósticos que se entienden de verdad.",
    body: "Lee cada avería que reporta tu coche, bórrala y entiende qué le pasa de verdad, no solo el código.",
    downloadMac: "Descargar para macOS",
    worksWithAdapter: "Funciona con el adaptador OBD-II que ya tienes",
    comingSoon: "{platform} llega pronto.",
    emailPlaceholder: "tucorreo@email.com",
    notifyMe: "Avísame",
    onTheList: "Ya estás en la lista. Te escribimos una sola vez.",
    oneEmail: "Un correo cuando salga la versión para {platform}. Nada más.",
    orDownloadMac: "O descarga la versión para macOS →",
  },
  showcase: {
    heading: "Todo lo que sabe tu coche, en una sola pantalla.",
    body: "Códigos, sensores en directo, cada módulo y cómo estaba la última vez. Nada escondido en menús.",
    screenshotAlt:
      "Pantalla de diagnóstico de Sonda: tres códigos de avería en dos módulos, con el primero abierto para mostrar qué significa y el fotograma de congelación capturado con él.",
    preview: {
      windowTitle: "Sonda — tu coche",
      sidebarPrimary: "Principal",
      sidebarAdvanced: "Avanzado",
      nav: {
        overview: "Resumen",
        diagnose: "Diagnóstico",
        live: "En directo",
        workshop: "Taller",
        lab: "Laboratorio",
        vehicle: "Vehículo",
      },
      adapter: "OBDLink MX+ · conectado",
      title: "Diagnóstico",
      subtitle: "3 averías en 2 módulos · escaneado hace 12 s",
      rescan: "Volver a escanear",
      clearCodes: "Borrar códigos",
      meaningLabel: "Qué significa",
      askSonda: "Pídele a Sonda el informe completo",
      freezeFrameLabel: "Fotograma de congelación",
      freezeFrame: [
        { label: "RPM", value: "742" },
        { label: "Refrigerante", value: "91 °C" },
        { label: "Ajuste de combustible", value: "+1,6 %" },
        { label: "Voltaje", value: "14,1 V" },
      ],
      primaryFault: {
        code: "P0301",
        title: "Fallo de encendido detectado en el cilindro 1",
        module: "Motor",
        status: "Confirmado",
        meaning:
          "El cilindro 1 no quema su combustible en cada ciclo. La centralita contó suficientes fallos como para guardar la avería y encender el testigo.",
      },
      otherFaults: [
        { code: "P0420", title: "Eficiencia del catalizador por debajo del umbral, banco 1", module: "Motor", status: "Pendiente" },
        { code: "U0121", title: "Comunicación perdida con el módulo ABS", module: "Pasarela", status: "Almacenado" },
      ],
    },
    features: [
      { title: "Lee cada código", body: "Almacenados, pendientes y permanentes, de cada módulo del bus — no solo del motor." },
      { title: "Borra códigos", body: "Apaga el testigo de avería una vez arreglado el fallo, y comprueba si vuelve." },
      { title: "Míralo en directo", body: "Ajuste de combustible, refrigerante, RPM, contadores de fallos de encendido — graficados con el motor en marcha." },
      { title: "Exporta un PDF", body: "Un código o el escaneo completo, como documento para entregar a un mecánico." },
    ],
  },
  howItWorks: {
    kicker: "Cómo funciona",
    heading: "Tres pasos. Sin cita.",
    steps: [
      { title: "Conecta el adaptador", body: "Cualquier adaptador OBD-II bajo el salpicadero: Bluetooth, Wi-Fi o USB. No vendemos hardware." },
      { title: "Sonda lee el coche", body: "VIN, marca, cada módulo del bus. Códigos de avería almacenados y pendientes, valores de sensores en directo, fotogramas de congelación." },
      { title: "Pregunta qué significa", body: "Pulsa un código y recibe el informe: la avería en palabras claras, causas ordenadas, la solución y el coste." },
    ],
  },
  connectors: {
    kicker: "Cualquier conector",
    heading: "El adaptador que ya tienes en la guantera.",
    body: "Sonda habla los protocolos estándar y también los del fabricante: OBD-II para el motor, UDS para los módulos a los que las herramientas genéricas nunca llegan.",
    list: ["ELM327", "OBDLink MX+", "Veepeak", "Vgate iCar", "Bluetooth", "Wi-Fi", "USB"],
    brandsRecognised: "24 marcas reconocidas",
  },
  comparison: {
    kicker: "Cómo te habla tu coche",
    heading: "La misma avería. Dos respuestas.",
    body: "Un lector de códigos te repite el código. Sonda escucha cada sensor que el coche esté dispuesto a dar, y luego te dice qué significa ese código para tu coche, hoy.",
    genericReader: {
      label: "Cualquier lector de códigos",
      code: "P0301",
      title: "Fallo de encendido detectado en el cilindro 1",
      rows: ["Por qué ha pasado", "A qué afecta", "Cómo arreglarlo", "Qué cuesta"],
      footer: "Y acabas buscando el número en Google.",
    },
    sonda: {
      confirmed: "Confirmado",
      code: "P0301",
      title: "Fallo de encendido detectado en el cilindro 1",
      whyHappened: "Por qué ha pasado",
      causes: [
        { label: "Bobina de encendido, cilindro 1", pct: 72 },
        { label: "Bujía desgastada", pct: 34 },
        { label: "Inyector obstruido", pct: 15 },
      ],
      explanation:
        "El contador de fallos de encendido solo subió en el cilindro 1 mientras el ajuste de combustible se mantuvo estable, así que la mezcla está bien y la chispa no. El voltaje de la batería se mantuvo en 14,1 V, lo que descarta los fallos correlacionados de bajo voltaje.",
      affects: {
        label: "A qué afecta si lo dejas así",
        body: "El combustible sin quemar llega al catalizador. Unas semanas así y aparece un P0420, una pieza mucho más cara.",
      },
      fix: {
        label: "Cómo arreglarlo",
        body: "Cambia la bobina del cilindro 1 por la del cilindro 2 y vuelve a escanear. Si el fallo se mueve con ella, la bobina es la avería y la bujía puede quedarse.",
      },
      cost: { label: "Qué debería costar", value: "60 – 140 €" },
      exportReport: "Exportar informe",
    },
    readToAnswer: "Lecturas usadas para responder este código",
    readToAnswerTags: [
      "Flujo de sensores en directo",
      "Fotograma de congelación",
      "Ajuste de combustible",
      "Voltaje de la batería",
      "Cada módulo que responde",
      "Tus escaneos anteriores",
    ],
    payPerReport: "Paga solo el informe que necesitas. Sin suscripción.",
  },
  pricing: {
    kicker: "Precio",
    heading: "Escanear es gratis. Compra un informe cuando lo necesites.",
    body: "Sin suscripción para particulares. Solo pagas cuando quieres que la IA te explique un código concreto.",
    individuals: {
      title: "Particulares",
      tag: "App gratis, pago por informe",
      rows: ["Tu coche, escaneos ilimitados", "Lee y borra códigos de avería", "Sensores en directo y fotogramas de congelación", "Compra un informe de IA para el código que te interese"],
    },
    shops: {
      title: "Talleres",
      tag: "Suscripción",
      rows: ["Tantos coches como trabajes", "Todo lo de la app gratuita", "Una cuota mensual de informes de IA", "Informes extra fuera de la cuota, pagados uno a uno"],
    },
    downloadMac: "Descargar para macOS",
    notifyMe: "Avísame cuando salga para {platform}",
  },
  footer: {
    tagline: "Habla con tu coche. Tu coche te responde.",
    platforms: "Plataformas",
    macAvailable: "macOS · disponible",
    windowsSoon: "Windows · próximamente",
    iphoneSoon: "iPhone · próximamente",
    androidSoon: "Android · próximamente",
    copyright: "© 2026 Sonda. Diagnóstico OBD-II para quien es dueño de su coche.",
    switchTo: "English",
  },
  platforms: {
    mac: "macOS",
    windows: "Windows",
    ios: "iPhone",
    android: "Android",
    other: "tu plataforma",
  },
};
