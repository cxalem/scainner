// Offline DTC knowledge — two layers, so EVERY code gets a useful page:
//
// 1. Structural decode (`decodeDtc`): the five characters of an OBD2 code
//    are themselves a taxonomy (system / generic-vs-manufacturer /
//    subsystem). Works for any syntactically valid code, no lookup needed.
// 2. Curated library (`DTC_LIBRARY`): rich entries (plain-language meaning,
//    ranked common causes, symptoms) for the codes that actually
//    show up in the field. Curated for quality over coverage — unknown
//    codes still get layer 1 plus the AI deep-dive.
//
// No network, ships in-app. Severity is about drivability/consequences,
// not repair cost.
//
// i18n note: `decodeDtc`'s return values stay English internally on
// purpose — they're used as stable grouping keys by lib/dtc-grouping.ts,
// and that file's tests assert against these exact strings. Translating
// them for DISPLAY happens one layer up, via `localizedSystem`/
// `localizedOrigin`/`localizedSubsystem` below, which map the existing
// English strings to Spanish rather than changing what `decodeDtc` itself
// returns or how grouping works. `dtcInfo`, by contrast, really does pick
// a different data source per locale (DTC_LIBRARY vs DTC_LIBRARY_ES) since
// its content isn't used as a grouping key anywhere.
import { DTC_LIBRARY_ES } from "./dtc-codes.es";
import type { Locale } from "@/i18n";

export type DtcStructure = {
  system: string; // Powertrain / Chassis / Body / Network
  origin: string; // SAE-standard (generic) vs manufacturer-specific
  subsystem: string | null; // e.g. "Ignition system or misfire" (P-codes)
};

export type DtcInfo = {
  title: string;
  meaning: string;
  causes: string[]; // ranked, most likely first
  symptoms: string[];
};

// Every code DTC_LIBRARY curates — a union, not `string`, so dtc-codes.es.ts
// typing its own library against `Record<DtcCode, DtcInfo>` fails `tsc` the
// moment the two libraries' key sets drift, same key-safety pattern as
// i18n/en.ts vs es.ts.
export type DtcCode =
  | "P0100" | "P0101" | "P0113" | "P0117" | "P0118" | "P0128" | "P0130" | "P0135"
  | "P0171" | "P0172" | "P0204" | "P0300" | "P0301" | "P0302" | "P0303" | "P0325" | "P0335"
  | "P0340" | "P0401" | "P0420" | "P0430" | "P0442" | "P0455" | "P0500" | "P0505"
  | "P0562" | "P0563" | "P0700" | "U0100" | "U0121";

const P_SUBSYSTEMS: Record<string, string> = {
  "0": "Fuel and air metering (auxiliary emission controls)",
  "1": "Fuel and air metering",
  "2": "Fuel and air metering (injector circuit)",
  "3": "Ignition system or misfire",
  "4": "Auxiliary emission controls",
  "5": "Vehicle speed control and idle control",
  "6": "Computer output circuits",
  "7": "Transmission",
  "8": "Transmission",
  "9": "Transmission",
};

export function decodeDtc(code: string): DtcStructure | null {
  const m = /^([PCBU])([0-3])(\d)(\d{2})$/i.exec(code.trim());
  if (!m) return null;
  const [, sys, origin, sub] = m;
  const system = { P: "Powertrain (engine, transmission, emissions)", C: "Chassis (brakes, steering, suspension)", B: "Body (airbags, lighting, comfort)", U: "Network (module communication)" }[
    sys.toUpperCase() as "P" | "C" | "B" | "U"
  ]!;
  return {
    system,
    origin:
      origin === "0" || origin === "2"
        ? "SAE-standard code — same meaning on every brand"
        : "Manufacturer-specific code — exact meaning defined by the carmaker",
    subsystem: sys.toUpperCase() === "P" ? (P_SUBSYSTEMS[sub] ?? null) : null,
  };
}

export const DTC_LIBRARY: Record<DtcCode, DtcInfo> = {
  P0100: { title: "MAF circuit malfunction", meaning: "The mass-airflow sensor's signal is out of range or missing, so the ECU can't measure how much air enters the engine.", causes: ["Disconnected/damaged MAF connector or wiring", "Dirty or failed MAF sensor", "Intake air leak near the sensor"], symptoms: ["Rough idle", "Hesitation on acceleration", "Higher fuel consumption"] },
  P0101: { title: "MAF performance out of range", meaning: "The airflow reading disagrees with what the ECU expects for the current throttle/RPM — the sensor responds, but implausibly.", causes: ["Dirty MAF element", "Intake leak after the sensor", "Clogged air filter", "Aging MAF sensor"], symptoms: ["Uneven idle", "Reduced power", "Fuel trims drifting"] },
  P0113: { title: "Intake air temp sensor high", meaning: "The intake-air temperature signal reads open-circuit (very cold/absent), so the ECU falls back to a default value.", causes: ["Unplugged/broken IAT connector", "Failed sensor", "Wiring open circuit"], symptoms: ["Often none day-to-day", "Slightly rich running, worse cold starts"] },
  P0117: { title: "Coolant temp sensor low", meaning: "Engine-coolant temperature signal is shorted low (reads extremely hot) — the ECU can't trust engine temperature.", causes: ["Failed ECT sensor", "Wiring short to ground", "Connector corrosion"], symptoms: ["Fans running constantly", "Hard starts", "Rich running"] },
  P0118: { title: "Coolant temp sensor high", meaning: "Engine-coolant temperature signal reads open (extremely cold) — cold-start enrichment never ends.", causes: ["Failed ECT sensor", "Wiring open circuit", "Unplugged connector"], symptoms: ["High consumption", "Black smoke when warm", "Poor idle when warm"] },
  P0128: { title: "Coolant below thermostat temperature", meaning: "The engine never reached proper operating temperature in the expected time — almost always a thermostat stuck open.", causes: ["Thermostat stuck open (typical)", "Failed ECT sensor", "Very low coolant level"], symptoms: ["Slow warm-up", "Weak cabin heat", "Higher consumption in winter"] },
  P0130: { title: "O2 sensor circuit (bank 1, sensor 1)", meaning: "The upstream oxygen sensor's signal is faulty — the ECU is losing its main feedback for fuel mixture.", causes: ["Aged/failed O2 sensor", "Wiring/connector damage (they run near hot parts)", "Exhaust leak near the sensor"], symptoms: ["Higher consumption", "Rough idle", "Emissions test failure"] },
  P0135: { title: "O2 sensor heater circuit (B1S1)", meaning: "The upstream O2 sensor's built-in heater isn't working, so the sensor stays inactive until exhaust heat warms it — long open-loop running after start.", causes: ["Failed sensor heater element", "Blown heater fuse", "Wiring fault"], symptoms: ["Higher consumption on short trips", "Emissions test failure"] },
  P0171: { title: "System too lean (bank 1)", meaning: "The ECU keeps adding fuel beyond normal limits because the mixture reads lean — extra air is getting in, or fuel/measurement is short.", causes: ["Vacuum/intake leak (split hose, inlet gasket)", "Dirty MAF under-reading airflow", "Weak fuel pump or clogged filter", "Leaking injector seals"], symptoms: ["Rough idle, hesitation", "Positive fuel trims well above +10%", "Possible misfires under load"] },
  P0172: { title: "System too rich (bank 1)", meaning: "The ECU keeps removing fuel beyond normal limits — the engine gets more fuel than the measured air justifies.", causes: ["Leaking/stuck injector", "Faulty fuel-pressure regulator", "MAF over-reading", "Stuck-closed purge valve logic issues"], symptoms: ["Fuel smell, black exhaust tint", "Negative fuel trims beyond −10%", "Fouled spark plugs over time"] },
  P0204: { title: "Injector circuit — cylinder 4", meaning: "The ECU can't drive cylinder 4's fuel injector correctly — an electrical fault (open circuit, short, or a failed driver) on that specific injector's circuit, distinct from a misfire code: this is about the wiring/coil, not the spray or combustion event itself.", causes: ["Injector 4 wiring or connector fault (corrosion, chafing, rodent damage)", "Failed injector coil/solenoid on cylinder 4", "ECU injector driver circuit fault (rarer, check the other injectors first)"], symptoms: ["Rough idle or a miss that tracks cylinder 4", "Power loss, especially under load", "MIL on, can flash if severe — see P0300-family codes if misfire is also stored"] },
  P0300: { title: "Random/multiple cylinder misfire", meaning: "Misfires detected across several cylinders — combustion is intermittently failing, and unburned fuel is reaching the catalyst.", causes: ["Worn spark plugs/coils (petrol)", "Vacuum leak leaning all cylinders", "Low fuel pressure", "Compression issues (least likely first check)"], symptoms: ["Shaking at idle", "Power loss", "Flashing check-engine under load (stop driving hard if so)"] },
  P0301: { title: "Cylinder 1 misfire", meaning: "Cylinder 1 specifically is intermittently failing to fire. The fault follows one cylinder, which narrows the hunt to its own plug, coil, injector, or compression.", causes: ["Spark plug or ignition coil on cyl 1 (swap-test with another cylinder)", "Injector on cyl 1", "Low compression in cyl 1 (valve/rings)"], symptoms: ["Rhythmic shake at idle", "Hesitation", "Flashing MIL under load if severe"] },
  P0302: { title: "Cylinder 2 misfire", meaning: "Cylinder 2 specifically is intermittently failing to fire — same diagnosis logic as any single-cylinder misfire.", causes: ["Plug/coil on cyl 2 (swap test)", "Injector on cyl 2", "Compression on cyl 2"], symptoms: ["Shake at idle", "Power loss"] },
  P0303: { title: "Cylinder 3 misfire", meaning: "Cylinder 3 specifically is intermittently failing to fire — same diagnosis logic as any single-cylinder misfire.", causes: ["Plug/coil on cyl 3 (swap test)", "Injector on cyl 3", "Compression on cyl 3"], symptoms: ["Shake at idle", "Power loss"] },
  P0325: { title: "Knock sensor circuit", meaning: "The knock sensor's signal is faulty — the ECU protects the engine by retarding ignition timing conservatively.", causes: ["Failed knock sensor", "Wiring/connector damage", "Loose sensor mounting"], symptoms: ["Slightly reduced power", "Higher consumption", "Usually no drivability drama"] },
  P0335: { title: "Crankshaft position sensor", meaning: "The crank sensor signal is faulty — this is the ECU's primary timing reference; a dead one means no start.", causes: ["Failing sensor (often heat-related, intermittent)", "Damaged reluctor ring", "Wiring fault"], symptoms: ["Stalling", "No-start or long cranking", "Tachometer dropouts"] },
  P0340: { title: "Camshaft position sensor", meaning: "The cam sensor signal is faulty — the ECU may fall back to crank-only running: it starts, but less precisely.", causes: ["Failed cam sensor", "Wiring fault", "Timing chain/belt stretch changing correlation"], symptoms: ["Long cranking", "Slight power loss", "Rough running"] },
  P0401: { title: "EGR flow insufficient", meaning: "The exhaust-gas-recirculation system isn't flowing as commanded — usually carbon clogging in the valve or passages.", causes: ["Carbon-clogged EGR valve/passages (typical, especially diesels)", "Stuck/failed EGR valve", "Faulty DPFE/flow sensor"], symptoms: ["Possible knock/pinging (petrol)", "Emission test failure", "Often no daily symptoms"] },
  P0420: { title: "Catalyst efficiency below threshold (bank 1)", meaning: "The rear O2 sensor sees almost the same signal as the front one — the catalytic converter is no longer storing/converting properly. Important: a tired catalyst is often the VICTIM of an upstream problem (misfires, rich running), not the root cause.", causes: ["Aged/degraded catalytic converter", "Misfires or rich mixture poisoning the cat (check other codes FIRST)", "Lazy front or rear O2 sensor giving a false reading", "Exhaust leak between the sensors"], symptoms: ["Usually none in daily driving", "Emissions inspection failure", "Sulphur smell in hard use if far gone"] },
  P0430: { title: "Catalyst efficiency below threshold (bank 2)", meaning: "Same as P0420 but on the second cylinder bank of a V-engine.", causes: ["Aged catalytic converter (bank 2)", "Upstream mixture/misfire problems", "Lazy O2 sensors on bank 2"], symptoms: ["Usually none daily", "Emissions failure"] },
  P0442: { title: "EVAP small leak", meaning: "The fuel-vapour system loses a small amount of pressure — a tiny leak somewhere between tank and purge valve.", causes: ["Loose or worn fuel filler cap (check first)", "Cracked EVAP hose", "Leaking purge/vent valve"], symptoms: ["None in driving", "Faint fuel smell sometimes"] },
  P0455: { title: "EVAP large leak", meaning: "The fuel-vapour system can't hold pressure at all — a big opening, most famously the filler cap left loose.", causes: ["Fuel cap loose/missing/bad seal (by far most common)", "Disconnected EVAP hose", "Failed vent valve"], symptoms: ["None in driving", "Fuel smell possible"] },
  P0500: { title: "Vehicle speed sensor", meaning: "The ECU isn't receiving a plausible road-speed signal.", causes: ["Failed VSS/wheel-speed source", "Wiring fault", "Instrument-cluster data issue"], symptoms: ["Speedometer dropouts", "Harsh/odd automatic shifting", "Cruise control disabled"] },
  P0505: { title: "Idle control system", meaning: "The ECU can't regulate idle speed to target — the idle path (valve or electronic throttle) isn't responding correctly.", causes: ["Carbon-fouled throttle body/idle valve", "Vacuum leak", "Failed idle control actuator"], symptoms: ["Idle too high/low or hunting", "Stalling at stops"] },
  P0562: { title: "System voltage low", meaning: "The ECU sees supply voltage below normal while running — the charging system isn't keeping up.", causes: ["Weak alternator or worn brushes", "Corroded battery terminals/grounds", "Aging battery dragging the bus down"], symptoms: ["Dim lights at idle", "Battery warning light", "Random electrical glitches"] },
  P0563: { title: "System voltage high", meaning: "Supply voltage above normal — the voltage regulator is overcharging, which cooks batteries and electronics.", causes: ["Failed voltage regulator/alternator", "Poor ground reference"], symptoms: ["Very bright lights", "Battery smell/heat", "Short bulb life"] },
  P0700: { title: "Transmission control system fault", meaning: "An umbrella code: the transmission control unit has stored its own fault and asked the engine ECU to turn the light on. The real detail lives in the TCU.", causes: ["Any transmission-side fault — read the TCU's own codes", "Wiring between TCU and ECU"], symptoms: ["Depends on the underlying TCU code", "Often limp mode or harsh shifts"] },
  U0100: { title: "Lost communication with ECM/PCM", meaning: "Another module can't reach the engine computer on the CAN bus — a network problem, not an engine problem.", causes: ["CAN wiring/connector fault", "Failing module pulling the bus down", "Low battery voltage during cranking (phantom entry)"], symptoms: ["Multiple warning lights at once", "Gauges dropping out", "Possible no-start"] },
  U0121: { title: "Lost communication with ABS module", meaning: "The ABS module stopped answering on the network.", causes: ["ABS module power/ground fault", "CAN wiring", "Failed ABS module"], symptoms: ["ABS + traction lights on", "Speedometer issues on some cars"] },
};

const LIBRARY_BY_LOCALE: Record<Locale, Record<DtcCode, DtcInfo>> = {
  en: DTC_LIBRARY,
  es: DTC_LIBRARY_ES,
};

export function dtcInfo(code: string, locale: Locale = "en"): DtcInfo | null {
  const upper = code.toUpperCase() as DtcCode;
  return LIBRARY_BY_LOCALE[locale][upper] ?? null;
}

// Translates decodeDtc()'s English display strings for Spanish — see the
// i18n note at the top of this file for why decodeDtc() itself doesn't
// take a locale. Falls back to the English string on a missing mapping
// (never crashes, never shows a blank) — a real safety net, not just
// defensive-looking code, since new system/subsystem strings only ever
// come from decodeDtc's own small fixed vocabulary above, not user input.
const SYSTEM_ES: Record<string, string> = {
  "Powertrain (engine, transmission, emissions)": "Motor y transmisión (motor, transmisión, emisiones)",
  "Chassis (brakes, steering, suspension)": "Chasis (frenos, dirección, suspensión)",
  "Body (airbags, lighting, comfort)": "Carrocería (airbags, iluminación, confort)",
  "Network (module communication)": "Red (comunicación entre módulos)",
  Other: "Otro",
};

const ORIGIN_ES: Record<string, string> = {
  "SAE-standard code — same meaning on every brand": "Código estándar SAE: mismo significado en todas las marcas",
  "Manufacturer-specific code — exact meaning defined by the carmaker":
    "Código específico del fabricante: el significado exacto lo define la marca",
};

const SUBSYSTEM_ES: Record<string, string> = {
  "Fuel and air metering (auxiliary emission controls)": "Medición de combustible y aire (controles auxiliares de emisiones)",
  "Fuel and air metering": "Medición de combustible y aire",
  "Fuel and air metering (injector circuit)": "Medición de combustible y aire (circuito de inyectores)",
  "Ignition system or misfire": "Sistema de encendido o fallo de encendido",
  "Auxiliary emission controls": "Controles auxiliares de emisiones",
  "Vehicle speed control and idle control": "Control de velocidad del vehículo y de ralentí",
  "Computer output circuits": "Circuitos de salida del ordenador",
  Transmission: "Transmisión",
};

export function localizedSystem(system: string, locale: Locale): string {
  return locale === "es" ? (SYSTEM_ES[system] ?? system) : system;
}

export function localizedOrigin(origin: string, locale: Locale): string {
  return locale === "es" ? (ORIGIN_ES[origin] ?? origin) : origin;
}

export function localizedSubsystem(subsystem: string, locale: Locale): string {
  return locale === "es" ? (SUBSYSTEM_ES[subsystem] ?? subsystem) : subsystem;
}
