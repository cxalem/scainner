// Spanish translation of DTC_LIBRARY (lib/dtc.ts) — the same ~30 curated
// entries, same keys (enforced by DtcCode: TS fails the build if this
// drifts from the English source, same key-safety pattern as en.ts/es.ts).
//
// Part of Phase 3 (docs/workflows/i18n/plan.md): this is automotive
// technical content, not UI chrome. Translated with real automotive
// terminology in mind, but this is an AI-assisted first draft — the plan
// explicitly calls for a human review pass on this file before it's
// trusted in front of real mechanics, same as it would for any technical
// translation. Flagging that here, not silently shipping it as gospel.
import type { DtcCode, DtcInfo } from "./dtc";

export const DTC_LIBRARY_ES: Record<DtcCode, DtcInfo> = {
  P0100: {
    title: "Fallo en el circuito del caudalímetro (MAF)",
    meaning: "La señal del sensor de caudal de aire está fuera de rango o ausente, así que la ECU no puede medir cuánto aire entra al motor.",
    causes: ["Conector o cableado del MAF desconectado o dañado", "Sensor MAF sucio o averiado", "Fuga de aire de admisión cerca del sensor"],
    symptoms: ["Ralentí irregular", "Titubeo al acelerar", "Mayor consumo de combustible"],
    severity: "medium",
  },
  P0101: {
    title: "Rendimiento del caudalímetro (MAF) fuera de rango",
    meaning: "La lectura de caudal de aire no coincide con lo que la ECU espera para el acelerador o las RPM actuales: el sensor responde, pero de forma poco creíble.",
    causes: ["Elemento del MAF sucio", "Fuga de admisión después del sensor", "Filtro de aire obstruido", "Sensor MAF envejecido"],
    symptoms: ["Ralentí inestable", "Menor potencia", "Ajustes de combustible (fuel trim) a la deriva"],
    severity: "medium",
  },
  P0113: {
    title: "Sensor de temperatura del aire de admisión, señal alta",
    meaning: "La señal de temperatura del aire de admisión lee circuito abierto (muy fría o ausente), así que la ECU usa un valor por defecto.",
    causes: ["Conector IAT desconectado o roto", "Sensor averiado", "Circuito abierto en el cableado"],
    symptoms: ["A menudo ninguno en el día a día", "Mezcla ligeramente rica, arranques en frío peores"],
    severity: "low",
  },
  P0117: {
    title: "Sensor de temperatura del refrigerante, señal baja",
    meaning: "La señal de temperatura del refrigerante está en cortocircuito a masa (lee extremadamente caliente): la ECU no puede confiar en la temperatura del motor.",
    causes: ["Sensor ECT averiado", "Cortocircuito del cableado a masa", "Corrosión en el conector"],
    symptoms: ["Ventiladores funcionando todo el tiempo", "Arranques difíciles", "Mezcla rica"],
    severity: "medium",
  },
  P0118: {
    title: "Sensor de temperatura del refrigerante, señal alta",
    meaning: "La señal de temperatura del refrigerante lee circuito abierto (extremadamente fría): el enriquecimiento de arranque en frío nunca termina.",
    causes: ["Sensor ECT averiado", "Circuito abierto en el cableado", "Conector desconectado"],
    symptoms: ["Alto consumo", "Humo negro en caliente", "Ralentí pobre en caliente"],
    severity: "medium",
  },
  P0128: {
    title: "Refrigerante por debajo de la temperatura del termostato",
    meaning: "El motor nunca alcanzó la temperatura de funcionamiento adecuada en el tiempo esperado: casi siempre un termostato atascado abierto.",
    causes: ["Termostato atascado abierto (lo típico)", "Sensor ECT averiado", "Nivel de refrigerante muy bajo"],
    symptoms: ["Calentamiento lento", "Calefacción débil en el habitáculo", "Mayor consumo en invierno"],
    severity: "low",
  },
  P0130: {
    title: "Circuito de la sonda lambda (banco 1, sensor 1)",
    meaning: "La señal de la sonda lambda anterior al catalizador es defectuosa: la ECU está perdiendo su principal referencia para la mezcla de combustible.",
    causes: ["Sonda lambda envejecida o averiada", "Daño en cableado o conector (funcionan cerca de piezas calientes)", "Fuga de escape cerca de la sonda"],
    symptoms: ["Mayor consumo", "Ralentí irregular", "Fallo en la inspección de emisiones"],
    severity: "medium",
  },
  P0135: {
    title: "Circuito calefactor de la sonda lambda (B1S1)",
    meaning: "El calefactor integrado de la sonda lambda anterior no funciona, así que la sonda permanece inactiva hasta que el calor del escape la calienta: funcionamiento en bucle abierto prolongado tras el arranque.",
    causes: ["Elemento calefactor de la sonda averiado", "Fusible del calefactor fundido", "Fallo de cableado"],
    symptoms: ["Mayor consumo en trayectos cortos", "Fallo en la inspección de emisiones"],
    severity: "low",
  },
  P0171: {
    title: "Mezcla demasiado pobre (banco 1)",
    meaning: "La ECU sigue añadiendo combustible más allá de los límites normales porque la mezcla lee pobre: está entrando aire de más, o falta combustible o su medición.",
    causes: ["Fuga de vacío o admisión (manguera partida, junta de admisión)", "MAF sucio subestimando el caudal de aire", "Bomba de combustible débil o filtro obstruido", "Juntas de inyector con fuga"],
    symptoms: ["Ralentí irregular, titubeo", "Ajustes de combustible positivos muy por encima del +10%", "Posibles fallos de encendido bajo carga"],
    severity: "medium",
  },
  P0172: {
    title: "Mezcla demasiado rica (banco 1)",
    meaning: "La ECU sigue quitando combustible más allá de los límites normales: el motor recibe más combustible del que justifica el aire medido.",
    causes: ["Inyector con fuga o atascado", "Regulador de presión de combustible defectuoso", "MAF sobreestimando el caudal", "Problemas en la lógica de la válvula de purga atascada cerrada"],
    symptoms: ["Olor a combustible, tono negro en el escape", "Ajustes de combustible negativos por debajo del −10%", "Bujías engrasadas con el tiempo"],
    severity: "medium",
  },
  P0204: {
    title: "Circuito del inyector — cilindro 4",
    meaning: "La ECU no puede accionar correctamente el inyector del cilindro 4: un fallo eléctrico (circuito abierto, cortocircuito o etapa de salida averiada) en ese circuito concreto, distinto de un código de fallo de encendido: esto va del cableado o la bobina, no del chorro ni del evento de combustión en sí.",
    causes: ["Cableado o conector del inyector 4 dañado (corrosión, roce, roedores)", "Bobina o solenoide del inyector 4 averiado", "Fallo en la etapa de salida de la ECU (menos probable, revisa antes los demás inyectores)"],
    symptoms: ["Ralentí irregular o un fallo que se nota en el cilindro 4", "Pérdida de potencia, sobre todo con carga", "Testigo de avería encendido, puede parpadear si es severo: revisa también los códigos de la familia P0300 si hay fallo de encendido guardado"],
    severity: "high",
  },
  P0300: {
    title: "Fallo de encendido aleatorio o en varios cilindros",
    meaning: "Se detectan fallos de encendido en varios cilindros: la combustión falla de forma intermitente y combustible sin quemar llega al catalizador.",
    causes: ["Bujías o bobinas desgastadas (gasolina)", "Fuga de vacío que empobrece todos los cilindros", "Presión de combustible baja", "Problemas de compresión (lo menos probable, revisar en último lugar)"],
    symptoms: ["Vibración en ralentí", "Pérdida de potencia", "Testigo de avería parpadeando bajo carga (evita conducir con fuerza si ocurre)"],
    severity: "high",
  },
  P0301: {
    title: "Fallo de encendido en el cilindro 1",
    meaning: "El cilindro 1 en concreto falla al encender de forma intermitente. El fallo sigue a un solo cilindro, lo que limita la búsqueda a su propia bujía, bobina, inyector o compresión.",
    causes: ["Bujía o bobina del cilindro 1 (probar intercambiándola con otro cilindro)", "Inyector del cilindro 1", "Compresión baja en el cilindro 1 (válvulas o segmentos)"],
    symptoms: ["Vibración rítmica en ralentí", "Titubeo", "Testigo de avería parpadeando bajo carga si es grave"],
    severity: "high",
  },
  P0302: {
    title: "Fallo de encendido en el cilindro 2",
    meaning: "El cilindro 2 en concreto falla al encender de forma intermitente: misma lógica de diagnóstico que cualquier fallo de encendido de un solo cilindro.",
    causes: ["Bujía o bobina del cilindro 2 (prueba de intercambio)", "Inyector del cilindro 2", "Compresión del cilindro 2"],
    symptoms: ["Vibración en ralentí", "Pérdida de potencia"],
    severity: "high",
  },
  P0303: {
    title: "Fallo de encendido en el cilindro 3",
    meaning: "El cilindro 3 en concreto falla al encender de forma intermitente: misma lógica de diagnóstico que cualquier fallo de encendido de un solo cilindro.",
    causes: ["Bujía o bobina del cilindro 3 (prueba de intercambio)", "Inyector del cilindro 3", "Compresión del cilindro 3"],
    symptoms: ["Vibración en ralentí", "Pérdida de potencia"],
    severity: "high",
  },
  P0325: {
    title: "Circuito del sensor de detonación (knock)",
    meaning: "La señal del sensor de detonación es defectuosa: la ECU protege el motor retrasando el avance de encendido de forma conservadora.",
    causes: ["Sensor de detonación averiado", "Daño en cableado o conector", "Sensor mal sujeto"],
    symptoms: ["Potencia ligeramente reducida", "Mayor consumo", "Normalmente sin drama en la conducción"],
    severity: "low",
  },
  P0335: {
    title: "Sensor de posición del cigüeñal",
    meaning: "La señal del sensor de cigüeñal es defectuosa: es la referencia principal de sincronización de la ECU; si falla del todo, el coche no arranca.",
    causes: ["Sensor fallando (a menudo por calor, intermitente)", "Rueda fónica dañada", "Fallo de cableado"],
    symptoms: ["Calado del motor", "No arranca o arranque prolongado", "Caídas en el cuentarrevoluciones"],
    severity: "high",
  },
  P0340: {
    title: "Sensor de posición del árbol de levas",
    meaning: "La señal del sensor de árbol de levas es defectuosa: la ECU puede recurrir a un funcionamiento basado solo en el cigüeñal, arranca, pero con menos precisión.",
    causes: ["Sensor de árbol de levas averiado", "Fallo de cableado", "Estiramiento de cadena o correa de distribución que altera la correlación"],
    symptoms: ["Arranque prolongado", "Ligera pérdida de potencia", "Funcionamiento irregular"],
    severity: "medium",
  },
  P0401: {
    title: "Caudal insuficiente de EGR",
    meaning: "El sistema de recirculación de gases de escape no fluye según lo ordenado: normalmente por obstrucción de carbonilla en la válvula o los conductos.",
    causes: ["Válvula o conductos de EGR obstruidos por carbonilla (típico, sobre todo en diésel)", "Válvula EGR atascada o averiada", "Sensor DPFE o de caudal defectuoso"],
    symptoms: ["Posible picado o detonación (gasolina)", "Fallo en la inspección de emisiones", "A menudo sin síntomas diarios"],
    severity: "low",
  },
  P0420: {
    title: "Eficiencia del catalizador por debajo del umbral (banco 1)",
    meaning: "La sonda lambda posterior ve casi la misma señal que la anterior: el catalizador ya no almacena ni convierte correctamente. Importante: un catalizador cansado suele ser la VÍCTIMA de un problema anterior (fallos de encendido, mezcla rica), no la causa raíz.",
    causes: ["Catalizador envejecido o degradado", "Fallos de encendido o mezcla rica envenenando el catalizador (revisa antes otros códigos)", "Sonda lambda anterior o posterior perezosa dando una lectura falsa", "Fuga de escape entre las sondas"],
    symptoms: ["Normalmente ninguno en la conducción diaria", "Fallo en la inspección de emisiones", "Olor a azufre en uso exigente si está muy deteriorado"],
    severity: "medium",
  },
  P0430: {
    title: "Eficiencia del catalizador por debajo del umbral (banco 2)",
    meaning: "Igual que P0420 pero en el segundo banco de cilindros de un motor en V.",
    causes: ["Catalizador envejecido (banco 2)", "Problemas de mezcla o fallos de encendido anteriores", "Sondas lambda perezosas en el banco 2"],
    symptoms: ["Normalmente ninguno a diario", "Fallo de emisiones"],
    severity: "medium",
  },
  P0442: {
    title: "Fuga pequeña en el sistema EVAP",
    meaning: "El sistema de vapores de combustible pierde una pequeña cantidad de presión: una fuga diminuta en algún punto entre el depósito y la válvula de purga.",
    causes: ["Tapón de combustible flojo o desgastado (revisar primero)", "Manguera EVAP agrietada", "Válvula de purga o ventilación con fuga"],
    symptoms: ["Ninguno al conducir", "A veces un leve olor a combustible"],
    severity: "low",
  },
  P0455: {
    title: "Fuga grande en el sistema EVAP",
    meaning: "El sistema de vapores de combustible no retiene presión en absoluto: una abertura grande, la más famosa es el tapón de combustible dejado suelto.",
    causes: ["Tapón de combustible suelto, ausente o con junta defectuosa (con diferencia lo más común)", "Manguera EVAP desconectada", "Válvula de ventilación averiada"],
    symptoms: ["Ninguno al conducir", "Posible olor a combustible"],
    severity: "low",
  },
  P0500: {
    title: "Sensor de velocidad del vehículo",
    meaning: "La ECU no está recibiendo una señal de velocidad creíble.",
    causes: ["Fuente VSS o de velocidad de rueda averiada", "Fallo de cableado", "Problema de datos del cuadro de instrumentos"],
    symptoms: ["Caídas del velocímetro", "Cambios automáticos bruscos o extraños", "Control de crucero desactivado"],
    severity: "medium",
  },
  P0505: {
    title: "Sistema de control de ralentí",
    meaning: "La ECU no puede regular la velocidad de ralentí al objetivo: la vía de ralentí (válvula o mariposa electrónica) no responde correctamente.",
    causes: ["Cuerpo de mariposa o válvula de ralentí sucios de carbonilla", "Fuga de vacío", "Actuador de control de ralentí averiado"],
    symptoms: ["Ralentí demasiado alto, bajo o inestable", "Se cala al detenerse"],
    severity: "medium",
  },
  P0562: {
    title: "Voltaje del sistema bajo",
    meaning: "La ECU detecta un voltaje de alimentación por debajo de lo normal en marcha: el sistema de carga no da abasto.",
    causes: ["Alternador débil o escobillas desgastadas", "Bornes o masas de la batería corroídos", "Batería envejecida sobrecargando el sistema"],
    symptoms: ["Luces tenues en ralentí", "Testigo de batería", "Fallos eléctricos aleatorios"],
    severity: "high",
  },
  P0563: {
    title: "Voltaje del sistema alto",
    meaning: "Voltaje de alimentación por encima de lo normal: el regulador de voltaje sobrecarga, lo que daña baterías y electrónica.",
    causes: ["Regulador de voltaje o alternador averiado", "Referencia de masa deficiente"],
    symptoms: ["Luces muy brillantes", "Olor o calor en la batería", "Vida corta de las bombillas"],
    severity: "high",
  },
  P0700: {
    title: "Fallo del sistema de control de la transmisión",
    meaning: "Un código paraguas: la unidad de control de la transmisión ha almacenado su propio fallo y le ha pedido a la ECU del motor que encienda el testigo. El detalle real está en la TCU.",
    causes: ["Cualquier fallo del lado de la transmisión (lee los propios códigos de la TCU)", "Cableado entre la TCU y la ECU"],
    symptoms: ["Depende del código subyacente de la TCU", "A menudo modo de emergencia o cambios bruscos"],
    severity: "high",
  },
  U0100: {
    title: "Pérdida de comunicación con el ECM o PCM",
    meaning: "Otro módulo no puede alcanzar el ordenador del motor en el bus CAN: un problema de red, no del motor.",
    causes: ["Fallo de cableado o conector CAN", "Un módulo averiado tirando del bus hacia abajo", "Voltaje de batería bajo durante el arranque (entrada fantasma)"],
    symptoms: ["Varios testigos encendidos a la vez", "Los indicadores se apagan", "Posible no arranque"],
    severity: "high",
  },
  U0121: {
    title: "Pérdida de comunicación con el módulo ABS",
    meaning: "El módulo ABS ha dejado de responder en la red.",
    causes: ["Fallo de alimentación o masa del módulo ABS", "Cableado CAN", "Módulo ABS averiado"],
    symptoms: ["Testigos de ABS y tracción encendidos", "Problemas de velocímetro en algunos coches"],
    severity: "high",
  },
};
