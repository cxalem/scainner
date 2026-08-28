#!/usr/bin/env python3
"""One-off migration of data/uds-map.json (and data/packs/*.json) from v8 to v9.

Kept in the repo so the v9 data is reproducible from the v8 file plus the
tables below, and so every migrated fact can be traced to a RESEARCH.md
section or a primary source (see docs/uds/migration-v9.md, which this script
also regenerates). Run once from packages/uds-map:

    python3 scripts/migrate-v8-to-v9.py

Rules (multi-brand plan, Phase 1):
- every module, band, known DID, family and decode gets a `source`
  {url, date, type, licence}; where RESEARCH.md names the primary source it
  is used, otherwise `type: community` with the RESEARCH.md section as url;
- brand names never appear in code paths: this script is data, and the
  tables below are the data being migrated;
- nothing is invented: where RESEARCH.md does not say which module a DID
  belongs to, the DID gets `modules: []` and `binding: "unknown"`.
"""

from __future__ import annotations

import json
import os
import re
from copy import deepcopy

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
DATA = os.path.join(PKG, "data", "uds-map.json")
OVERLAY = os.path.join(PKG, "data", "packs", "obdb-citroen.json")
LOG = os.path.join(os.path.dirname(os.path.dirname(PKG)), "docs", "uds", "migration-v9.md")

TODAY = "2026-08-28"
RESEARCH_DATE = "2026-08-23"
RESEARCH = "packages/uds-map/RESEARCH.md"

log: list[tuple[str, str, str]] = []  # (fact, json path, source id)


def note(fact: str, path: str, source_id: str) -> None:
    log.append((fact, path, source_id))


# --------------------------------------------------------------------------
# Source catalogue. Licences were read from the GitHub API on 2026-08-28;
# NOASSERTION means the repository ships a LICENSE file GitHub cannot
# classify, and the acquisition protocol's licence gate then treats the
# source as verification evidence only.
# --------------------------------------------------------------------------
def src(url: str, type_: str, licence: str, date: str = RESEARCH_DATE, note_: str | None = None) -> dict:
    d = {"url": url, "date": date, "type": type_, "licence": licence}
    if note_:
        d["note"] = note_
    return d


def research(section: str, note_: str | None = None) -> dict:
    return src(f"{RESEARCH}#{section}", "community", "MIT", RESEARCH_DATE, note_)


GH = "https://github.com/"
SOURCES: dict[str, dict] = {
    "ovms": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3", "open_implementation", "NOASSERTION"),
    "ovms_bmwi3": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_bmwi3", "open_implementation", "NOASSERTION"),
    "ovms_leaf": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_nissanleaf", "open_implementation", "NOASSERTION"),
    "ovms_ioniq5": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_hyundai_ioniq5", "open_implementation", "NOASSERTION"),
    "ovms_soulev": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_kiasoulev", "open_implementation", "NOASSERTION"),
    "ovms_vweup": src(GH + "openvehicles/Open-Vehicle-Monitoring-System-3/tree/master/vehicle/OVMS.V3/components/vehicle_vweup", "open_implementation", "NOASSERTION"),
    "wican": src(GH + "meatpiHQ/wican-fw/tree/main/vehicle_profiles", "open_implementation", "GPL-3.0"),
    "wican_600e": src(GH + "meatpiHQ/wican-fw/blob/main/vehicle_profiles/fiat/600e.json", "open_implementation", "GPL-3.0"),
    "wican_astra": src(GH + "meatpiHQ/wican-fw/blob/main/vehicle_profiles/opel/astra.json", "open_implementation", "GPL-3.0"),
    "wican_opel": src(GH + "meatpiHQ/wican-fw/blob/main/vehicle_profiles/opel/opel.json", "open_implementation", "GPL-3.0"),
    "wican_sierra": src(GH + "meatpiHQ/wican-fw/blob/main/vehicle_profiles/gmc/sierra.json", "open_implementation", "GPL-3.0"),
    "wican_ford": src(GH + "meatpiHQ/wican-fw/tree/main/vehicle_profiles/ford", "open_implementation", "GPL-3.0"),
    "wican_ram": src(GH + "meatpiHQ/wican-fw/tree/main/vehicle_profiles/ram", "open_implementation", "GPL-3.0"),
    "obdb": src(GH + "OBDb", "community", "CC-BY-SA-4.0"),
    "obdb_leaf": src(GH + "OBDb/Nissan-Leaf", "community", "CC-BY-SA-4.0"),
    "obdb_eqb": src(GH + "OBDb/Mercedes-Benz-EQB", "community", "CC-BY-SA-4.0"),
    "obdb_polestar2": src(GH + "OBDb/Polestar-2", "community", "CC-BY-SA-4.0"),
    "obdb_xc40": src(GH + "OBDb/Volvo-XC40-Recharge", "community", "CC-BY-SA-4.0"),
    "obdb_id4": src(GH + "OBDb/Volkswagen-ID.4", "community", "CC-BY-SA-4.0"),
    "obdb_born": src(GH + "OBDb/Cupra-Born", "community", "CC-BY-SA-4.0"),
    "obdb_prius": src(GH + "OBDb/Toyota-Prius", "community", "CC-BY-SA-4.0"),
    "obdb_toyota": src(GH + "OBDb", "community", "CC-BY-SA-4.0", note_="Toyota-Prius, Toyota-Prius-Prime, Toyota-RAV4-Hybrid signalsets"),
    "obdb_honda": src(GH + "OBDb", "community", "CC-BY-SA-4.0", note_="Honda Civic and Acura TLX signalsets; bit offsets deliberately not copied (base point unconfirmed)"),
    "obdb_mazda": src(GH + "OBDb", "community", "CC-BY-SA-4.0", note_="Mazda signalsets"),
    "obdb_citroen": src(GH + "OBDb/Citroen/blob/11a539aaf695097b03bedd9a568170c44a912df3/signalsets/v3/default.json", "community", "CC-BY-SA-4.0", TODAY),
    "canze": src(GH + "fesch/CanZE", "open_implementation", "NOASSERTION", note_="assets/ZOE/_Ecus.csv and _Fields.csv"),
    "opendbc": src(GH + "commaai/opendbc", "open_implementation", "MIT"),
    "opendbc_uds": src(GH + "commaai/opendbc/blob/master/opendbc/car/uds.py", "open_implementation", "MIT"),
    "opendbc_tesla": src(GH + "commaai/opendbc/blob/master/opendbc/car/tesla/values.py", "open_implementation", "MIT"),
    "evnotipi": src(GH + "EVNotify/EVNotiPi", "open_implementation", "NOASSERTION"),
    "psa_diag": src(GH + "ludwig-v/arduino-psa-diag/blob/master/ECU_LIST.md", "community", "GPL-3.0"),
    "psa_diag_bmf": src(GH + "ludwig-v/arduino-psa-diag/blob/master/zones/BMF.md", "community", "GPL-3.0"),
    "psa_diag_flash": src(GH + "ludwig-v/arduino-psa-diag/blob/master/UDS_FLASH.md", "community", "GPL-3.0"),
    "vag_uds_ids": src(GH + "ConnorHowell/vag-uds-ids", "community", "unlicensed", note_="extracted from VW's ODIS database"),
    "dpf_monitor": src(GH + "v-cu/dpf-load-monitor-wide", "open_implementation", "NOASSERTION"),
    "rcp_bmw": src(GH + "jcevanco/rcp_bmw_service_0x22/blob/master/src/inc/pid_debug.lua", "open_implementation", "GPL-3.0"),
    "w203": src(GH + "rnd-ash/W203-canbus", "open_implementation", "MIT"),
    "jejusoul": src(GH + "JejuSoul/OBD-PIDs-for-HKMC-EVs", "community", "unlicensed"),
    "volvo_gauge": src(GH + "Alfaa123/Volvo-CAN-Gauge", "open_implementation", "unlicensed"),
    "volvo_vida": src(GH + "Tigo2000/Volvo-VIDA", "open_implementation", "GPL-3.0"),
    "model3dbc": src(GH + "joshwardell/model3dbc", "community", "MIT"),
    "car_hacking": src(GH + "projectgus/car_hacking", "open_implementation", "BSD-3-Clause"),
    "diagbox_table": src(GH + "jyseojys/diag-server", "tool_screen", "unlicensed", "2026-08-27", "Diagbox-derived definitions; used as hypotheses only, nothing copied"),
    "project": src("apps/desktop/docs/workflows/parked-vehicle-verification.md", "project_capture", "MIT", "2026-08-27", "this project's own reads on one vehicle; evidence under apps/desktop/docs/workflows/evidence/"),
    "project_hunt": src("docs/uds/hunt_results.txt", "project_capture", "MIT", RESEARCH_DATE, "this project's own 430-identifier sweep of one vehicle (UDS_INVESTIGATION_LOG.md)"),
    "project_abs_research": src("apps/desktop/docs/research/c41-abs-did-research.md", "project_capture", "MIT", "2026-08-27"),
    "vpic": src("https://vpic.nhtsa.dot.gov/api/", "oem", "public domain (US federal)", TODAY, "NHTSA vPIC VIN decoding of manufacturer-submitted patterns, queried 2026-08-28 with DecodeVinValues"),
}


def S(key: str) -> dict:
    return deepcopy(SOURCES[key])


# --------------------------------------------------------------------------
# Per-brand default sources (RESEARCH.md section 4) for entries without a
# more specific source in the tables below.
# --------------------------------------------------------------------------
BRAND_SOURCES: dict[str, dict[str, str]] = {
    "psa": {"modules": "psa_diag", "bands": "project_hunt", "dids": "psa_diag_bmf"},
    "opel_psa": {"modules": "wican_astra", "bands": "wican_astra", "dids": "wican_astra"},
    "vag": {"modules": "vag_uds_ids", "bands": "ovms_vweup", "dids": "ovms_vweup"},
    "skoda": {"modules": "vag_uds_ids", "bands": "ovms_vweup", "dids": "vag_uds_ids"},
    "seat": {"modules": "vag_uds_ids", "bands": "ovms_vweup", "dids": "vag_uds_ids"},
    "cupra": {"modules": "vag_uds_ids", "bands": "ovms_vweup", "dids": "vag_uds_ids"},
    "bmw": {"modules": "ovms_bmwi3", "bands": "ovms_bmwi3", "dids": "ovms_bmwi3"},
    "mercedes": {"modules": "w203", "bands": "obdb_eqb", "dids": "obdb_eqb"},
    "renault": {"modules": "canze", "bands": "canze", "dids": "canze"},
    "nissan": {"modules": "ovms_leaf", "bands": "obdb_leaf", "dids": "obdb_leaf"},
    "hyundai_kia": {"modules": "ovms_ioniq5", "bands": "ovms_ioniq5", "dids": "evnotipi"},
    "ford": {"modules": "wican_ford", "bands": "wican_ford", "dids": "wican_ford"},
    "gm": {"modules": "wican_sierra", "bands": "wican_sierra", "dids": "wican_sierra"},
    "fca": {"modules": "wican_ram", "bands": "wican_ram", "dids": "wican_ram"},
    "toyota": {"modules": "obdb_toyota", "bands": "obdb_toyota", "dids": "obdb_toyota"},
    "honda": {"modules": "obdb_honda", "bands": "obdb_honda", "dids": "obdb_honda"},
    "mazda": {"modules": "obdb_mazda", "bands": "obdb_mazda", "dids": "obdb_mazda"},
    "volvo": {"modules": "obdb_polestar2", "bands": "obdb_polestar2", "dids": "obdb_polestar2"},
    "subaru": {"modules": "research:4-honda--acura-mazda-subaru-mitsubishi", "bands": "research:4-honda--acura-mazda-subaru-mitsubishi", "dids": "research:4-honda--acura-mazda-subaru-mitsubishi"},
    "mitsubishi": {"modules": "car_hacking", "bands": "research:4-honda--acura-mazda-subaru-mitsubishi", "dids": "car_hacking"},
    "tesla": {"modules": "opendbc_tesla", "bands": "opendbc_tesla", "dids": "opendbc_tesla"},
}

# Module-level source overrides: (brand, req) -> source id.
MODULE_SOURCE: dict[tuple[str, str], str] = {
    ("psa", "6A8"): "project",
    ("psa", "6AD"): "project",
    ("psa", "6B5"): "project",
    ("psa", "6B4"): "wican_600e",
    ("psa", "79B"): "research:4-psa--stellantis-europe--highest-confidence-in-the-file",
    ("vag", "7E0"): "ovms_vweup",
    ("vag", "7E5"): "obdb_id4",
    ("vag", "7E6"): "ovms_vweup",
    ("vag", "765"): "ovms_vweup",
    ("vag", "757"): "opendbc",
    ("vag", "715"): "opendbc",
    ("cupra", "7E5"): "obdb_born",
    ("cupra", "715"): "opendbc",
    ("cupra", "757"): "opendbc",
    ("bmw", "6F1"): "ovms_bmwi3",
    ("bmw", "7E0"): "research:4-bmw--mini",
    ("mercedes", "7E0"): "research:4-mercedes-benz--weakest-brand-in-the-file-by-a-wide-margin",
    ("mercedes", "7E1"): "research:4-mercedes-benz--weakest-brand-in-the-file-by-a-wide-margin",
    ("mercedes", "7E2"): "obdb_eqb",
    ("mercedes", "7E5"): "obdb_eqb",
    ("nissan", "743"): "obdb_leaf",
    ("nissan", "797"): "obdb_leaf",
    ("nissan", "7E0"): "research:4-nissan--infiniti",
    ("nissan", "745"): "research:4-nissan--infiniti",
    ("hyundai_kia", "7D6"): "ovms_soulev",
    ("hyundai_kia", "7B3"): "evnotipi",
    ("hyundai_kia", "730"): "opendbc",
    ("hyundai_kia", "7B1"): "opendbc",
    ("hyundai_kia", "7B7"): "opendbc",
    ("ford", "7E0"): "opendbc",
    ("ford", "760"): "research:4-ford",
    ("ford", "737"): "research:4-ford",
    ("gm", "7E0"): "opendbc",
    ("gm", "24B"): "opendbc",
    ("gm", "241"): "wican_sierra",
    ("gm", "14DACBF1"): "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs",
    ("fca", "7E0"): "opendbc",
    ("fca", "6B4"): "wican_600e",
    ("fca", "18DA10F1"): "wican_ram",
    ("toyota", "7E0"): "opendbc",
    ("toyota", "7D2"): "obdb_prius",
    ("toyota", "747"): "obdb_toyota",
    ("toyota", "7E2"): "research:4-toyota--lexus",
    ("honda", "7E0"): "research:4-honda--acura-mazda-subaru-mitsubishi",
    ("volvo", "18DA10F1"): "obdb_polestar2",
}

# Band-level source overrides: (brand, from) -> source id.
BAND_SOURCE: dict[tuple[str, str], str] = {
    ("psa", "D400"): "project_hunt",
    ("psa", "D600"): "project_hunt",
    ("psa", "D700"): "project_hunt",
    ("psa", "D900"): "project_hunt",
    ("psa", "DA00"): "project_hunt",
    ("psa", "D000"): "project_hunt",
    ("psa", "D800"): "wican_600e",
    ("psa", "2100"): "psa_diag_bmf",
    ("psa", "2200"): "psa_diag_bmf",
    ("psa", "F080"): "project",
    ("psa", "F180"): "opendbc_uds",
    ("vag", "F400"): "research:32-the-f4xx-obd-pid-mirror-band",
    ("vag", "1850"): "obdb_id4",
    ("vag", "1821"): "obdb_id4",
    ("vag", "5170"): "obdb_id4",
    ("vag", "1000"): "dpf_monitor",
    ("cupra", "1850"): "obdb_born",
    ("cupra", "1821"): "obdb_born",
    ("cupra", "1D00"): "obdb_born",
    ("cupra", "7400"): "obdb_born",
    ("bmw", "4200"): "rcp_bmw",
    ("mercedes", "6050"): "obdb_eqb",
    ("mercedes", "2001"): "obdb_eqb",
    ("mercedes", "F180"): "opendbc_uds",
    ("mercedes", "F400"): "research:32-the-f4xx-obd-pid-mirror-band",
    ("nissan", "1100"): "obdb_leaf",
    ("nissan", "1200"): "ovms_leaf",
    ("nissan", "0E00"): "obdb_leaf",
    ("hyundai_kia", "0100"): "evnotipi",
    ("hyundai_kia", "C000"): "ovms_ioniq5",
    ("hyundai_kia", "B000"): "ovms_ioniq5",
    ("ford", "DE00"): "opendbc",
    ("ford", "F400"): "wican_ford",
    ("gm", "5005"): "wican_sierra",
    ("gm", "2700"): "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs",
    ("gm", "5400"): "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs",
    ("fca", "D400"): "wican_600e",
    ("fca", "F100"): "opendbc",
    ("volvo", "F180"): "obdb_polestar2",
}

# --------------------------------------------------------------------------
# Known DID module bindings, from RESEARCH.md and the entries' own labels.
# (brand, did) -> list of "REQ/RESP" or [] for an honest unknown binding.
# A DID missing here keeps whatever v8 bound (PSA) or gets binding unknown.
# --------------------------------------------------------------------------
BINDINGS: dict[tuple[str, str], list[str]] = {
    ("opel_psa", "D410"): ["6B4/694"],
    ("opel_psa", "D860"): ["6B4/694"],
    ("opel_psa", "D815"): ["6B4/694"],
    ("vag", "2203"): ["714/77E"],
    ("vag", "2260"): ["714/77E"],
    ("vag", "2261"): ["714/77E"],
    ("vag", "22E0"): ["714/77E"],
    ("vag", "22E4"): ["714/77E"],
    ("vag", "1821"): ["713/77D"],
    ("vag", "1E3B"): ["7E5/7ED"],
    ("vag", "1E3D"): ["7E5/7ED"],
    ("vag", "028C"): ["7E5/7ED"],
    ("vag", "1DD0"): ["765/7CF"],
    ("vag", "1E33"): ["7E5/7ED"],
    ("vag", "1E34"): ["7E5/7ED"],
    ("vag", "2A0B"): [],
    ("vag", "74CB"): ["7E5/7ED"],
    ("vag", "1E0E"): [],
    ("vag", "1E0F"): [],
    ("vag", "02BD"): ["7E5/7ED"],
    ("vag", "465C"): ["7E6/7EE"],
    ("vag", "465B"): ["7E6/7EE"],
    ("vag", "F45B"): ["7E0/7E8"],
    ("vag", "11BE"): ["7E0/7E8"],
    ("vag", "11B2"): ["7E0/7E8"],
    ("vag", "10F9"): ["7E0/7E8"],
    ("vag", "10FB"): ["7E0/7E8"],
    ("vag", "1156"): ["7E0/7E8"],
    ("vag", "115E"): ["7E0/7E8"],
    ("vag", "114F"): ["7E0/7E8"],
    ("vag", "F40C"): [],
    ("vag", "F41F"): [],
    ("vag", "F802"): ["7E0/7E8"],
    ("vag", "51E0"): ["7E5/7ED"],
    ("skoda", "2203"): ["714/77E"],
    ("skoda", "2260"): ["714/77E"],
    ("skoda", "2261"): ["714/77E"],
    ("skoda", "1821"): ["713/77D"],
    ("seat", "2203"): ["714/77E"],
    ("seat", "2260"): ["714/77E"],
    ("seat", "2261"): ["714/77E"],
    ("seat", "1821"): ["713/77D"],
    ("cupra", "2203"): ["714/77E"],
    ("cupra", "2260"): ["714/77E"],
    ("cupra", "1821"): ["713/77D"],
    ("cupra", "1E33"): ["7E5/7ED"],
    ("cupra", "1E34"): ["7E5/7ED"],
    ("cupra", "1E3B"): ["7E5/7ED"],
    ("cupra", "1E3D"): ["7E5/7ED"],
    ("cupra", "028C"): ["7E5/7ED"],
    ("cupra", "51E0"): ["7E5/7ED"],
    ("bmw", "DD68"): ["6F1/607"],
    ("bmw", "DD69"): ["6F1/607"],
    ("bmw", "DDBC"): ["6F1/607"],
    ("bmw", "D10D"): ["6F1/660"],
    ("bmw", "D107"): ["6F1/660"],
    ("bmw", "DEA7"): [],
    ("bmw", "DE84"): [],
    ("bmw", "DEF5"): [],
    ("bmw", "DB99"): [],
    ("bmw", "4300"): ["6F1/612"],
    ("bmw", "4650"): ["6F1/612"],
    ("bmw", "5890"): ["6F1/612"],
    ("bmw", "580F"): ["6F1/612"],
    ("bmw", "586F"): ["6F1/612"],
    ("bmw", "56D7"): ["6F1/612"],
    ("bmw", "F410"): ["6F1/610"],
    ("mercedes", "2001"): ["7E2/7EA"],
    ("mercedes", "2002"): ["7E2/7EA"],
    ("mercedes", "2005"): ["7E5/7ED"],
    ("mercedes", "2526"): ["7E5/7ED"],
    ("mercedes", "6050"): ["7E5/7ED"],
    ("mercedes", "6053"): ["7E5/7ED"],
    ("mercedes", "6071"): ["7E5/7ED"],
    ("mercedes", "6075"): ["7E5/7ED"],
    ("mercedes", "6502"): ["7E5/7ED"],
    ("mercedes", "6504"): ["7E5/7ED"],
    ("renault", "2002"): ["7E4/7EC"],
    ("renault", "2005"): ["7E4/7EC"],
    ("renault", "2006"): ["7E4/7EC"],
    ("renault", "3206"): ["7E4/7EC"],
    ("renault", "3451"): ["7E4/7EC"],
    ("renault", "3444"): ["7E4/7EC"],
    ("renault", "FD1C"): ["7CA/7DA"],
    ("nissan", "1103"): ["797/79A"],
    ("nissan", "1183"): ["797/79A"],
    ("nissan", "1146"): ["797/79A"],
    ("nissan", "121A"): ["797/79A"],
    ("nissan", "1236"): ["797/79A"],
    ("nissan", "1234"): ["797/79A"],
    ("nissan", "1255"): ["797/79A"],
    ("nissan", "0E2E"): ["743/763"],
    ("nissan", "1203"): ["797/79A"],
    ("nissan", "1205"): ["797/79A"],
    ("nissan", "0E01"): ["743/763"],
    ("hyundai_kia", "0101"): ["7E4/7EC"],
    ("hyundai_kia", "0105"): ["7E4/7EC"],
    ("hyundai_kia", "0102"): ["7E4/7EC"],
    ("hyundai_kia", "0103"): ["7E4/7EC"],
    ("hyundai_kia", "0104"): ["7E4/7EC"],
    ("hyundai_kia", "B002"): ["7C6/7CE"],
    ("hyundai_kia", "C00B"): ["7A0/7A8"],
    ("hyundai_kia", "C002"): ["7A0/7A8"],
    ("hyundai_kia", "E004"): ["7E2/7EA"],
    ("hyundai_kia", "F100"): [],
    ("hyundai_kia", "F110"): [],
    ("ford", "4028"): ["726/72E"],
    ("ford", "402A"): ["726/72E"],
    ("ford", "402B"): ["726/72E"],
    ("ford", "4029"): ["726/72E"],
    ("ford", "2813"): ["726/72E"],
    ("ford", "2814"): ["726/72E"],
    ("ford", "2815"): ["726/72E"],
    ("ford", "2816"): ["726/72E"],
    ("ford", "054B"): ["7E0/7E8"],
    ("ford", "1E1C"): [],
    ("ford", "1E12"): [],
    ("ford", "F45C"): ["7E0/7E8"],
    ("ford", "F405"): ["7E0/7E8"],
    ("ford", "F40F"): ["7E0/7E8"],
    ("ford", "F42F"): ["7E0/7E8"],
    ("ford", "DD01"): ["726/72E"],
    ("ford", "DD04"): ["726/72E"],
    ("ford", "DE00"): [],
    ("gm", "5005"): ["241/641"],
    ("gm", "27C6"): ["14DACBF1/142AF1CB"],
    ("gm", "27AF"): ["14DACBF1/142AF1CB"],
    ("gm", "00DF"): [],
    ("gm", "006D"): [],
    ("fca", "D410"): ["6B4/694"],
    ("fca", "D860"): ["6B4/694"],
    ("fca", "D815"): ["6B4/694"],
    ("fca", "B010"): [],
    ("fca", "0121"): [],
    ("fca", "022A"): [],
    ("fca", "F132"): [],
    ("toyota", "1F5B"): ["7D2/7DA"],
    ("toyota", "1F9A"): [],
    ("toyota", "106C"): [],
    ("toyota", "182E"): ["747/74F"],
    ("toyota", "1829"): ["747/74F"],
    ("toyota", "1F05"): [],
    ("toyota", "1074"): [],
    ("toyota", "1022"): ["7C0/7C8"],
    ("toyota", "1021"): [],
    ("toyota", "10A2"): ["7D2/7DA"],
    ("toyota", "10A6"): ["7D2/7DA"],
    ("honda", "2660"): ["18DA10F1/18DAF110"],
    ("honda", "2610"): ["18DA10F1/18DAF110"],
    ("honda", "2615"): ["18DA10F1/18DAF110"],
    ("honda", "2663"): ["18DA10F1/18DAF110"],
    ("honda", "6001"): ["18DA26F1/18DAF126"],
    ("honda", "7028"): ["18DA60F1/18DAF160"],
    ("honda", "F112"): [],
    ("mazda", "1310"): [],
    ("mazda", "1E1C"): [],
    ("mazda", "61B1"): [],
    ("mazda", "2A05"): ["720/728"],
    ("mazda", "2A0A"): ["720/728"],
    ("mazda", "0415"): [],
    ("mazda", "D901"): [],
    ("volvo", "EE6F"): [],
    ("volvo", "4028"): [],
    ("subaru", "F100"): [],
}

# Known DID source overrides: (brand, did) -> source id.
DID_SOURCE: dict[tuple[str, str], str] = {
    ("psa", "D422"): "project_hunt",
    ("psa", "D4B1"): "project_hunt",
    ("psa", "D410"): "wican_600e",
    ("psa", "D860"): "wican_600e",
    ("psa", "D815"): "wican_600e",
    ("psa", "F08F"): "project_hunt",
    ("psa", "D619"): "project_hunt",
    ("psa", "D412"): "diagbox_table",
    ("opel_psa", "D410"): "wican_600e",
    ("opel_psa", "D860"): "wican_600e",
    ("opel_psa", "D815"): "wican_600e",
    ("vag", "1E3B"): "obdb_id4",
    ("vag", "1E3D"): "obdb_id4",
    ("vag", "028C"): "obdb_id4",
    ("vag", "1E33"): "obdb_id4",
    ("vag", "1E34"): "obdb_id4",
    ("vag", "51E0"): "obdb_id4",
    ("vag", "11BE"): "dpf_monitor",
    ("vag", "11B2"): "dpf_monitor",
    ("vag", "10F9"): "dpf_monitor",
    ("vag", "10FB"): "dpf_monitor",
    ("vag", "1156"): "dpf_monitor",
    ("vag", "115E"): "dpf_monitor",
    ("vag", "114F"): "dpf_monitor",
    ("vag", "F40C"): "research:32-the-f4xx-obd-pid-mirror-band",
    ("vag", "F41F"): "research:32-the-f4xx-obd-pid-mirror-band",
    ("vag", "1821"): "vag_uds_ids",
    ("vag", "2203"): "vag_uds_ids",
    ("vag", "2260"): "vag_uds_ids",
    ("vag", "2261"): "vag_uds_ids",
    ("vag", "22E0"): "vag_uds_ids",
    ("vag", "22E4"): "vag_uds_ids",
    ("vag", "F802"): "vag_uds_ids",
    ("cupra", "1E33"): "obdb_born",
    ("cupra", "1E34"): "obdb_born",
    ("cupra", "1E3B"): "obdb_born",
    ("cupra", "1E3D"): "obdb_born",
    ("cupra", "028C"): "obdb_born",
    ("cupra", "51E0"): "obdb_born",
    ("bmw", "4300"): "rcp_bmw",
    ("bmw", "4650"): "rcp_bmw",
    ("bmw", "5890"): "rcp_bmw",
    ("bmw", "580F"): "rcp_bmw",
    ("bmw", "586F"): "rcp_bmw",
    ("bmw", "56D7"): "rcp_bmw",
    ("bmw", "F410"): "research:4-bmw--mini",
    ("nissan", "1203"): "ovms_leaf",
    ("nissan", "1205"): "ovms_leaf",
    ("hyundai_kia", "0101"): "ovms_ioniq5",
    ("hyundai_kia", "0105"): "evnotipi",
    ("hyundai_kia", "B002"): "ovms_ioniq5",
    ("hyundai_kia", "C00B"): "ovms_ioniq5",
    ("hyundai_kia", "C002"): "ovms_ioniq5",
    ("hyundai_kia", "E004"): "ovms_ioniq5",
    ("hyundai_kia", "F100"): "research:4-hyundai--kia--genesis",
    ("hyundai_kia", "F110"): "research:4-hyundai--kia--genesis",
    ("ford", "DE00"): "opendbc",
    ("ford", "F45C"): "research:4-ford",
    ("gm", "27C6"): "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs",
    ("gm", "27AF"): "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs",
    ("gm", "00DF"): "wican_opel",
    ("gm", "006D"): "wican_opel",
    ("fca", "D410"): "wican_600e",
    ("fca", "D860"): "wican_600e",
    ("fca", "D815"): "wican_600e",
    ("fca", "F132"): "opendbc",
    ("toyota", "10A2"): "obdb_prius",
    ("toyota", "10A6"): "obdb_prius",
    ("volvo", "EE6F"): "obdb_polestar2",
    ("volvo", "4028"): "obdb_polestar2",
}

# Per-module read service overrides (RESEARCH.md section 3.3).
MODULE_READ_SERVICE: dict[tuple[str, str], tuple[str, str]] = {
    ("nissan", "79B"): ("21", "ovms_leaf"),
    ("renault", "79B"): ("21", "canze"),
    ("renault", "745"): ("21", "canze"),
    ("hyundai_kia", "7D6"): ("21", "ovms_soulev"),
    ("toyota", "7E2"): ("1A", "research:33-not-every-brands-data-is-behind-service-0x22"),
}

# --------------------------------------------------------------------------
# Decodes. Each entry replaces/extends the v8 scalar with real decodes.
# Fields: offset, len, signed, encoding, [bit_offset, bit_len], scale, bias,
# unit, quantity, label.
# --------------------------------------------------------------------------
def dec(offset, len_, scale, bias, unit, quantity, label, signed=False, encoding="be", bit_offset=None, bit_len=None):
    d = {
        "offset": offset,
        "len": len_,
        "signed": signed,
        "encoding": encoding,
    }
    if bit_offset is not None:
        d["bit_offset"] = bit_offset
        d["bit_len"] = bit_len
    d.update({"scale": scale, "bias": bias, "unit": unit, "quantity": quantity, "label": label})
    return d


# Quantity for a scalar entry, from its unit and label.
QUANTITY_BY_UNIT = {
    "V": "voltage", "A": "current", "%": "percentage", "km": "distance", "km/h": "speed",
    "C": "temperature", "F": "temperature", "K": "temperature", "bar": "pressure", "kPa": "pressure",
    "hPa": "pressure", "psi": "pressure", "PSI": "pressure", "MPa": "pressure", "°": "angle",
    "rpm": "rotational_speed", "W": "power", "kW": "power", "kWh": "energy", "min": "time",
    "flag": "flag", "L": "volume", "m": "distance", "raw": "raw", "Ah": "charge",
}


def quantity_for(unit: str | None, label: str) -> str:
    if unit and unit in QUANTITY_BY_UNIT:
        return QUANTITY_BY_UNIT[unit]
    low = label.lower()
    if "temperature" in low:
        return "temperature"
    if "odometer" in low or "distance" in low or "range" in low:
        return "distance"
    if "voltage" in low:
        return "voltage"
    if "current" in low:
        return "current"
    if "pressure" in low:
        return "pressure"
    if "count" in low:
        return "count"
    if "string" in low or "identifier" in low or "vin" in low or "imei" in low:
        return "identifier"
    return "raw"


# Explicit multi-value / signed decodes (brand, did) -> list of decodes.
# Where a note explains a deliberate choice it is logged.
EXTRA_DECODES: dict[tuple[str, str], list[dict]] = {
    ("psa", "D40F"): [dec(0, 1, 1.0, 0.0, "raw", "raw", "EPS torque/current candidate A", signed=True)],
    ("psa", "D411"): [dec(0, 1, 1.0, 0.0, "raw", "raw", "EPS torque/current candidate B", signed=True)],
    ("vag", "74CB"): [
        dec(0, 2, 0.01, 0.0, "Ah", "charge", "HV battery capacity"),
        dec(2, 1, 1.0, 0.0, "count", "count", "Cell count"),
    ],
    ("vag", "2A0B"): [dec(0, 2, 0.015625, 0.0, "C", "temperature", "HV battery pack temperature", signed=True)],
    ("mercedes", "2001"): [
        dec(0, 2, 0.05625, 0.0, "km/h", "speed", "Wheel speed front-left"),
        dec(2, 2, 0.05625, 0.0, "km/h", "speed", "Wheel speed front-right"),
        dec(4, 2, 0.05625, 0.0, "km/h", "speed", "Wheel speed rear-left"),
        dec(6, 2, 0.05625, 0.0, "km/h", "speed", "Wheel speed rear-right"),
    ],
    ("mercedes", "2526"): [dec(0, 2, 0.125, 0.0, "C", "temperature", "HV battery coolant temperature", signed=True)],
    ("mercedes", "6053"): [dec(0, 2, 0.1, 0.0, "A", "current", "HV battery current", signed=True)],
    ("nissan", "1183"): [dec(0, 2, 0.00390625, 0.0, "A", "current", "12V battery current", signed=True)],
    ("toyota", "1F9A"): [
        dec(2, 2, 0.015625, 0.0, "V", "voltage", "HV pack voltage"),
        dec(4, 2, 0.1, -3276.8, "A", "current", "HV pack current (offset-binary: raw × 0.1 − 3276.8)"),
    ],
    ("hyundai_kia", "0101"): [
        dec(4, 1, 0.5, 0.0, "%", "percentage", "BMS state of charge"),
        dec(10, 2, 0.1, 0.0, "A", "current", "HV battery current, positive when discharging", signed=True),
        dec(12, 2, 0.1, 0.0, "V", "voltage", "HV battery pack voltage"),
        dec(14, 1, 1.0, 0.0, "C", "temperature", "Maximum battery module temperature", signed=True),
        dec(15, 1, 1.0, 0.0, "C", "temperature", "Minimum battery module temperature", signed=True),
    ],
    ("hyundai_kia", "C00B"): [
        dec(4, 1, 0.2, 0.0, "PSI", "pressure", "TPMS tyre pressure front-left"),
        dec(9, 1, 0.2, 0.0, "PSI", "pressure", "TPMS tyre pressure front-right"),
        dec(14, 1, 0.2, 0.0, "PSI", "pressure", "TPMS tyre pressure rear-left"),
        dec(19, 1, 0.2, 0.0, "PSI", "pressure", "TPMS tyre pressure rear-right"),
    ],
    ("hyundai_kia", "C002"): [
        dec(4, 4, 1.0, 0.0, "id", "identifier", "TPMS sensor id 1"),
        dec(8, 4, 1.0, 0.0, "id", "identifier", "TPMS sensor id 2"),
        dec(12, 4, 1.0, 0.0, "id", "identifier", "TPMS sensor id 3"),
        dec(16, 4, 1.0, 0.0, "id", "identifier", "TPMS sensor id 4"),
    ],
    ("hyundai_kia", "E004"): [
        dec(14, 1, 1.0, 0.0, "gear", "enum", "Gear (low nibble)", encoding="bitfield", bit_offset=0, bit_len=4),
        dec(9, 1, 1.0, 0.0, "raw", "raw", "Accelerator pedal (raw byte; scale not sourced)"),
    ],
}

# Per-cell voltage blocks: (brand, did) -> (first cell index, cell count)
CELL_BLOCKS = {
    ("hyundai_kia", "0102"): (1, 32),
    ("hyundai_kia", "0103"): (33, 32),
    ("hyundai_kia", "0104"): (65, 32),
}

# Sibling DIDs described only inside another entry's label; each becomes its
# own known DID with the same formula and binding.
SIBLING_DIDS: dict[tuple[str, str], list[tuple[str, str]]] = {
    ("mazda", "2A05"): [("2A06", "Tyre pressure, wheel 2"), ("2A07", "Tyre pressure, wheel 3"), ("2A08", "Tyre pressure, wheel 4")],
    ("mazda", "2A0A"): [("2A0B", "Tyre temperature, wheel 2"), ("2A0C", "Tyre temperature, wheel 3"), ("2A0D", "Tyre temperature, wheel 4")],
}

# --------------------------------------------------------------------------
# Identity blocks (layouts name encodings, never brands).
# --------------------------------------------------------------------------
ISO_IDENTITY = [
    {"did": "F187", "field": "part", "layout": "iso_ascii"},
    {"did": "F191", "field": "hardware", "layout": "iso_ascii"},
    {"did": "F195", "field": "software", "layout": "iso_ascii"},
    {"did": "F197", "field": "system", "layout": "iso_ascii"},
    {"did": "F18C", "field": "serial", "layout": "iso_ascii"},
    {"did": "F18A", "field": "supplier", "layout": "iso_ascii"},
    {"did": "F190", "field": "vin", "layout": "iso_ascii"},
]

VENDOR_IDENTITY: dict[str, tuple[list[dict], str]] = {
    "psa": (
        [
            {"did": "F080", "field": "part", "layout": "bcd_part_refs", "offset": 0, "len": 5},
            {"did": "F080", "field": "hardware", "layout": "bcd_part_refs", "offset": 7, "len": 5},
            {"did": "F0FE", "field": "software", "layout": "bcd_part_refs", "offset": 21, "len": 3, "prefix": "96", "suffix": "80"},
            {"did": "F0FE", "field": "supplier", "layout": "raw", "offset": 4, "len": 1},
        ],
        "project_abs_research",
    ),
    "vag": ([{"did": "F802", "field": "vin", "layout": "iso_ascii"}], "vag_uds_ids"),
    "fca": ([{"did": "F132", "field": "software", "layout": "iso_ascii"}], "opendbc"),
    "honda": ([{"did": "F112", "field": "other", "layout": "raw"}], "obdb_honda"),
    "subaru": ([{"did": "F100", "field": "software", "layout": "iso_ascii"}], "research:4-honda--acura-mazda-subaru-mitsubishi"),
    "hyundai_kia": (
        [
            {"did": "F100", "field": "other", "layout": "iso_ascii"},
            {"did": "F110", "field": "other", "layout": "iso_ascii"},
        ],
        "research:4-hyundai--kia--genesis",
    ),
}

# --------------------------------------------------------------------------
# Platforms. vds_pattern is a regex over VIN characters 4-10 (7 characters)
# and is only set where a registry confirmed the prefix; otherwise null and
# the platform is selectable by evidence only.
# --------------------------------------------------------------------------
def platform(key, years, notes, source_id, vds=None, families=None, read_service=None):
    p = {"key": key, "vds_pattern": vds, "years": list(years), "ecu_families_expected": families or []}
    if read_service:
        p["read_service"] = read_service
    p["notes"] = notes
    p["source"] = source_id
    return p


PLATFORMS: dict[str, list[dict]] = {
    "psa": [
        platform("c41", (2020, None), "C4 III generation; the vehicle this project's captures come from (engine 6A8/688, ABS 6AD/68D, EPS 6B5/695, camera 74A/64A). No registry-confirmed VDS pattern yet.", "project", families=["cont_esp_mk100_psa", "dae_uds2_psa", "cvm3_psa"]),
    ],
    "opel_psa": [
        platform("stellantis_era", (2017, None), "WMI W0V (Opel Automobile GmbH); Astra K onward inherits the Stellantis EV/PSA DID set on service 22 (wican astra.json extends fiat/600e.json).", "wican_astra", read_service="22"),
    ],
    "vag": [
        platform("kwp2000_tp20", (None, None), "Cars predating UDS use KWP2000 over TP2.0 and do not answer service 22; years not sourced.", "research:4-vag-vw-audi--škoda-seat-cupra"),
        platform("pre_meb_e_up", (2013, 2020), "e-Up generation; the battery DIDs and formulas on 7E5/7ED were validated here (OVMS vehicle_vweup).", "ovms_vweup", read_service="22"),
        platform("meb", (2020, None), "ID.3/ID.4/ID.5; the legacy 11-bit 7E5/7ED module is still alive and carries 1E33/1E34/1E3B/1E3D and SOH 51E0 (74CB not present). A richer 29-bit FC00 + target-address surface exists but its request-id construction is unconfirmed and is deliberately not encoded.", "obdb_id4", read_service="22"),
    ],
    "cupra": [
        platform("meb_born", (2021, None), "Born (built at Zwickau, WMI unconfirmed); MEB battery DIDs on 7E5/7ED confirmed via OBDb Cupra-Born fixtures.", "obdb_born", read_service="22"),
    ],
    "bmw": [
        platform("i3_ev", (2013, 2022), "i3 (WMI WBY); Dxxx band; SME target 07, KOM 60, DSC 29 per OVMS vehicle_bmwi3. HV SOC/SOH may be more reliable from SME broadcasts (CAN ids 1164/1165 dec) than from polling.", "ovms_bmwi3"),
        platform("d_can_combustion", (None, None), "Combustion DMEs on D-CAN: 42xx-59xx band on target 12 (rcp_bmw_service_0x22); years not sourced.", "rcp_bmw"),
        platform("f_g_series_enet", (None, None), "F/G-series over ENET: tester address becomes F4 and the gateway is 10; ZGW/GWS routes could not be re-verified.", "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs"),
    ],
    "mercedes": [
        platform("kwp_w203_w211", (2000, 2009), "Pre-UDS KWP2000 generation (W203/W209/W211/W219): the 730/4F6, 6B8/4F8, 791/4F1, 4E0/5FF, 796/797, 5B4/4F4, 784/785, 77A/77B, 662/4E2, 563/4E3 pairs. Read service not sourced.", "w203"),
        platform("eqb_mfa2", (2023, 2025), "EQB (MFA2): 7E2/7EA chassis and 7E5/7ED HV battery with byte-verified DIDs from OBDb test fixtures. EQA has the same-looking set but no fixtures (not copied).", "obdb_eqb", read_service="22"),
        platform("eva2_eqe_eqs", (2021, None), "EQE/EQS (EVA2): the EQB DIDs were actively tested and do NOT answer; no working DIDs in any public source. Tested negative, not merely unexplored.", "obdb_eqb"),
    ],
    "renault": [
        platform("zoe", (2012, None), "Zoe: CanZE _Ecus.csv/_Fields.csv is the source of every route and decode; EVC/DCM on 22, LBC/UCH on 21.", "canze"),
    ],
    "nissan": [
        platform("leaf_ze0", (2011, 2017), "Leaf ZE0/AZE0 (VDS AZ0 per NHTSA vPIC): LBC 79B/7BB on service 21 groups 01/02/04/06; PDM 797/79A and VCM 743/763 on 22.", "vpic", vds="^AZ0", read_service="22"),
        platform("leaf_ze1", (2018, None), "Leaf ZE1 (VDS AZ1 per NHTSA vPIC): as ZE0 plus LBC group 61 (SOH).", "vpic", vds="^AZ1", read_service="22"),
    ],
    "hyundai_kia": [
        platform("ps_soul_ev", (2014, 2019), "Older PS platform (Soul EV): service 21 local IDs and TPMS at 7D6/7DE (OVMS vehicle_kiasoulev).", "ovms_soulev", read_service="21"),
        platform("e_gmp", (2021, None), "E-GMP (Ioniq 5, EV6): service 22, TPMS at 7A0/7A8, BMS 7E4/7EC (OVMS vehicle_hyundai_ioniq5).", "ovms_ioniq5", read_service="22"),
    ],
    "ford": [
        platform("wican_profiled", (None, None), "Transit and Focus RS Mk3 are the only two published wican-fw Ford profiles; BCM 726/72E carries battery, tyre and odometer data. Tyre-pressure scaling varies by platform (kPa vs PSI).", "wican_ford", read_service="22"),
    ],
    "gm": [
        platform("pre_2017_gmlan", (None, 2016), "GM and GM-era Opel (WMI W0L) before 2017: odometer DF and oil life 6D are read with KWP service 1A, not 22; GMLAN group 241/641 on 22 for tyre pressures.", "wican_opel", read_service="1A"),
        platform("ultium", (2022, None), "Ultium EVs: 29-bit 14DACBF1 -> 142AF1CB scheme (neither normal-fixed nor 11-bit); battery telemetry 27xx and charger 54xx bands.", "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs", read_service="22"),
    ],
    "fca": [
        platform("sgw_2018", (2018, None), "US-market vehicles with the Security Gateway: reads (DTCs, live data, VIN) work, writes are blocked; some modules reported silent depending on gateway firmware.", "research:4-fca--stellantis-north-america", read_service="22"),
        platform("stellantis_ev", (2020, None), "Fiat 600e and siblings: HV battery block D410/D815/D860 on 6B4/694 (wican fiat/600e.json).", "wican_600e", read_service="22"),
    ],
    "toyota": [
        platform("legacy_kwp_hybrid", (None, 2009), "Older Prius generations: hybrid ECU at the legacy KWP address 7E2/7EA; version data via 1A 88 01.", "research:4-toyota--lexus", read_service="1A"),
        platform("modern_ths", (2010, None), "2010s+ hybrids: hybrid vehicle control ECU at 7D2/7DA, cell-level battery data on 747/74F; sweep 1000-10FF and 1800-1FFF first.", "obdb_toyota", read_service="22"),
        platform("ths5_e_four", (2023, None), "5th-gen THS (XW60 Prius 2023+, e-Four AWD): 10A2 rear motor torque and 10A6 rear inverter temperatures on 7D2/7DA (single source).", "obdb_prius", read_service="22"),
    ],
    "honda": [
        platform("29bit_target_iteration", (None, None), "29-bit normal fixed addressing 18DA<target>F1 / 18DAF1<target>; targets 10 PCM, 1D TCM, 60 meter/HVAC, 26 TPMS, 01 body; the sweeper iterates target bytes.", "obdb_honda", read_service="22"),
        platform("e_hev_2022", (2022, None), "e:HEV CR-V/Civic/Accord hybrids: OBDb repos are empty stubs; no hybrid battery DIDs known (confirmed gap).", "research:job-2-outcome-extension-newer-models"),
    ],
    "volvo": [
        platform("p1_p2_vida", (None, 2019), "P1/P2-era VIDA: requests on fixed 29-bit id 000FFFFE with the ECU address as a payload byte and a proprietary command set (A6 read, A3 security, B1 IO). Not ISO 14229 over standard addressing; no route is encoded.", "volvo_vida"),
        platform("cma_spa2", (2020, None), "XC40/C40 Recharge and Polestar 2 (VDS ED3 per NHTSA vPIC): standard 29-bit normal-fixed 18DA10F1/18DAF110 confirmed by a Mode 01 exchange in OBDb fixtures; manufacturer DIDs EE6F/4028 have unconfirmed request ids.", "vpic", vds="^ED3", read_service="22"),
    ],
    "subaru": [
        platform("solterra_bz4x", (2023, None), "Solterra shares Toyota's bZ4X platform, so Toyota-style addressing is plausible but is speculation and is not encoded.", "research:4-honda--acura-mazda-subaru-mitsubishi"),
    ],
    "mitsubishi": [
        platform("outlander_phev", (2013, None), "Outlander PHEV: DTC reads exist via proprietary KWP2000-flavoured sessions (10 92 / 18 00 FF 00) after a per-vehicle brute-force address scan; SOC/SOH live on an internal BMU bus not exposed at the connector. No read-only route encoded.", "car_hacking"),
    ],
    "tesla": [
        platform("model_3_y", (2017, None), "Model 3/Y (VDS 3 or Y per NHTSA vPIC): UDS servers exist (opendbc fingerprints F18x on bus 0) but that bus is only reachable behind the Autopilot computer harness; the OBD-class connector exposes broadcast frames only. Adapter-path limited.", "vpic", vds="^[3Y]"),
        platform("model_s_x", (2012, None), "Model S/X (VDS S or X per NHTSA vPIC): a diagnostic-port path is described in Model S/X-era documentation only; not profiled.", "vpic", vds="^[SX]"),
    ],
}

GATEWAY: dict[str, dict] = {
    "psa": {"silence_means": "absent", "writes_blocked": False, "notes": "Body-network modules (BSI 752/652) sit on OBD pins an ELM327-class adapter is not wired to; a silent BSI is normal on pins 6/14, not filtering.", "source": "project_hunt"},
    "mercedes": {"silence_means": "filtered", "writes_blocked": False, "notes": "The OBD-port gateway silently drops traffic for unrecognised diagnostic CAN ids; a non-response may mean filtered, not absent.", "source": "research:4-mercedes-benz--weakest-brand-in-the-file-by-a-wide-margin"},
    "fca": {"silence_means": "unknown", "writes_blocked": True, "notes": "Security Gateway (2018+ US market) blocks writes, reads work; some modules reported silent depending on gateway firmware.", "source": "research:4-fca--stellantis-north-america"},
    "vag": {"silence_means": "unknown", "writes_blocked": False, "notes": "Gateway J533 (710/77A) is the only module directly on the OBD port and proxies the sub-buses.", "source": "vag_uds_ids"},
}

PROFILED_LEVEL: dict[str, str] = {
    "psa": "decodes_verified",
    # External corpora are sourced research until their raw exchanges are
    # committed as replay fixtures and exercised by this repository.
    "mercedes": "routes_sourced",
    "nissan": "routes_sourced",
    "volvo": "routes_sourced",
    "vag": "routes_sourced",
    "cupra": "routes_sourced",
    "opel_psa": "routes_sourced",
    "skoda": "routes_sourced",
    "seat": "routes_sourced",
    "bmw": "routes_sourced",
    "renault": "routes_sourced",
    "hyundai_kia": "routes_sourced",
    "ford": "routes_sourced",
    "gm": "routes_sourced",
    "fca": "routes_sourced",
    "toyota": "routes_sourced",
    "honda": "routes_sourced",
    "mazda": "routes_sourced",
    "subaru": "routes_sourced",
    "mitsubishi": "standard_only",
    "tesla": "standard_only",
}

BRAND_READ_SERVICE: dict[str, str | None] = {b: "22" for b in PROFILED_LEVEL}
BRAND_READ_SERVICE["mitsubishi"] = None
BRAND_READ_SERVICE["tesla"] = None

SCAN_POLICY: dict[str, tuple[str, str]] = {
    "bmw": ("conventional_11bit_and_target_byte_11bit", "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs"),
    "honda": ("conventional_11bit_and_normal_fixed_29bit", "research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs"),
}

F4XX_NOTE = " Demoted to low in v9: a mode-01 mirror that burns 256 reads to rediscover standard PIDs; its value is on modules that do not answer mode-01 (RESEARCH.md section 3.2)."


def resolve(source_id: str) -> dict:
    if source_id.startswith("research:"):
        return research(source_id.split(":", 1)[1])
    return S(source_id)


def is_29bit(addr: str) -> bool:
    return len(addr.strip()) == 8


def derived_route(req: str, resp: str) -> dict:
    if is_29bit(req):
        r, p = int(req, 16), int(resp, 16)
        if (r & 0xFFFF00FF) == 0x18DA00F1 and (p & 0xFFFFFF00) == 0x18DAF100:
            return {"protocol": "can29_normal_fixed", "req": req, "resp": resp, "target_byte": f"{(r >> 8) & 0xFF:02X}"}
        return {"protocol": "can29_custom", "req": req, "resp": resp}
    return {"protocol": "can11_500", "req": req, "resp": resp}


def scalar_decode(k: dict, quantity: str) -> dict | None:
    if k.get("offset") is None or k.get("len") is None or k.get("scale") is None or k.get("bias") is None:
        return None
    return dec(k["offset"], k["len"], k["scale"], k["bias"], k.get("unit") or "", quantity, k["label"])


def migrate_brand(b: dict) -> dict:
    bid = b["id"]
    defaults = BRAND_SOURCES[bid]
    used: dict[str, dict] = {}

    def use(source_id: str) -> dict:
        s = resolve(source_id)
        used[s["url"]] = s
        return deepcopy(s)

    # modules
    for m in b.get("modules", []):
        sid = MODULE_SOURCE.get((bid, m["req"]), defaults["modules"])
        m["source"] = use(sid)
        m["route"] = derived_route(m["req"], m["resp"])
        rs = MODULE_READ_SERVICE.get((bid, m["req"]))
        if rs:
            m["read_service"] = rs[0]
            note(f"module {m['req']}/{m['resp']} read service {rs[0]}", f"brands[{bid}].modules[{m['req']}].read_service", rs[1])
        if m["route"]["protocol"] != "can11_500":
            note(f"module {m['req']}/{m['resp']} route {m['route']['protocol']}", f"brands[{bid}].modules[{m['req']}].route", sid)

    if bid == "bmw":
        for m in b["modules"]:
            if m["req"] == "6F1":
                target = m["resp"][-2:]
                m["route"] = {"protocol": "can11_500", "req": "6F1", "resp": m["resp"], "target_byte": target, "address_extension": target}
                m["route"]["source"] = use("ovms_bmwi3")
                note(f"D-CAN target byte {target} (request 6F1, response 600+target, ISO-TP extended address)", f"brands[bmw].modules[{m['resp']}].route", "ovms_bmwi3")
    if bid == "gm":
        for m in b["modules"]:
            if m["req"] == "14DACBF1":
                m["route"]["source"] = use("research:35-two-oem-address-schemes-that-are-not-simple-11-bit-pairs")

    # bands
    for band in b.get("did_bands", []):
        sid = BAND_SOURCE.get((bid, band["from"]), defaults["bands"])
        band["source"] = use(sid)
        if band["from"] == "F400" and band["to"] == "F4FF" and band.get("confidence") != "low":
            band["confidence"] = "low"
            band["note"] = (band.get("note") or "") + F4XX_NOTE
            band["source"] = use("research:32-the-f4xx-obd-pid-mirror-band")
            note("F4xx mode-01 mirror band demoted to low", f"brands[{bid}].did_bands[F400]", "research:32-the-f4xx-obd-pid-mirror-band")

    # known DIDs
    out_dids: list[dict] = []
    for k in b.get("known_dids", []):
        key = (bid, k["did"])
        sid = DID_SOURCE.get(key, defaults["dids"])
        if k.get("evidence") and bid == "psa" and key not in DID_SOURCE:
            sid = "project"
        k["source"] = use(sid)
        if key in BINDINGS:
            mods = BINDINGS[key]
            k["modules"] = [{"req": x.split("/")[0], "resp": x.split("/")[1]} for x in mods]
            if mods:
                note(f"DID {k['did']} bound to {', '.join(mods)}", f"brands[{bid}].known_dids[{k['did']}].modules", sid)
        if not k.get("modules"):
            k["modules"] = []
            k["binding"] = "unknown"
        quantity = quantity_for(k.get("unit"), k["label"])
        decodes = list(EXTRA_DECODES.get(key, []))
        if key in CELL_BLOCKS:
            first, count = CELL_BLOCKS[key]
            decodes = [dec(i, 1, 0.02, 0.0, "V", "voltage", f"Cell voltage {first + i}") for i in range(count)]
            note(f"DID {k['did']}: {count} per-cell voltage decodes (0.02 V/byte)", f"brands[{bid}].known_dids[{k['did']}].decodes", sid)
        if not decodes:
            s = scalar_decode(k, quantity)
            if s:
                decodes = [s]
        elif key in EXTRA_DECODES:
            note(f"DID {k['did']}: {len(decodes)} decodes from label/note text", f"brands[{bid}].known_dids[{k['did']}].decodes", sid)
        k["decodes"] = decodes
        # scalar mirror of decodes[0]
        if decodes:
            first = decodes[0]
            k["offset"], k["len"], k["scale"], k["bias"] = first["offset"], first["len"], first["scale"], first["bias"]
            if first.get("unit"):
                k["unit"] = first["unit"]
        out_dids.append(k)
        for sib_did, sib_label in SIBLING_DIDS.get(key, []):
            sib = deepcopy(k)
            sib["did"] = sib_did
            sib["label"] = f"{sib_label} (TPMS 720/728)"
            sib["decodes"] = deepcopy(decodes)
            if sib["decodes"]:
                sib["decodes"][0]["label"] = sib["label"]
            out_dids.append(sib)
            note(f"sibling DID {sib_did} split out of the {k['did']} label", f"brands[{bid}].known_dids[{sib_did}]", sid)
    b["known_dids"] = out_dids

    # brand-level fields
    rs = BRAND_READ_SERVICE[bid]
    if rs:
        b["read_service"] = rs
    if bid in SCAN_POLICY:
        pol, sid = SCAN_POLICY[bid]
        b["scan_policy"] = pol
        use(sid)
        note(f"scan policy {pol}", f"brands[{bid}].scan_policy", sid)
    vendor, vsid = VENDOR_IDENTITY.get(bid, ([], "opendbc_uds"))
    b["identity_block"] = {"dids": deepcopy(ISO_IDENTITY) + deepcopy(vendor), "source": use(vsid)}
    if vendor:
        note(f"identity block: {len(vendor)} vendor field(s) on top of ISO", f"brands[{bid}].identity_block", vsid)
    plats = []
    for p in PLATFORMS.get(bid, []):
        p = deepcopy(p)
        sid = p["source"]
        p["source"] = use(sid)
        plats.append(p)
        note(f"platform {p['key']} ({p['years'][0] or '?'}-{p['years'][1] or 'now'})", f"brands[{bid}].platforms[{p['key']}]", sid)
    b["platforms"] = plats
    if bid in GATEWAY:
        g = deepcopy(GATEWAY[bid])
        sid = g["source"]
        g["source"] = use(sid)
        b["gateway_behaviour"] = g
        note(f"gateway behaviour: silence means {g['silence_means']}, writes_blocked={g['writes_blocked']}", f"brands[{bid}].gateway_behaviour", sid)
    b["profiled_level"] = PROFILED_LEVEL[bid]
    b["sources"] = list(used.values())
    note(f"profiled_level {PROFILED_LEVEL[bid]}", f"brands[{bid}].profiled_level", "derived")
    return b


def migrate_families(families: list[dict]) -> None:
    for f in families:
        f["source"] = S("project")
        for d in f["decodes"]:
            d["quantity"] = quantity_for(d.get("unit"), d["label"])


def migrate_overlay() -> None:
    with open(OVERLAY, encoding="utf-8") as fh:
        pack = json.load(fh)
    pack["version"] = 2
    for b in pack["brands"]:
        for m in b["modules"]:
            m["source"] = S("obdb_citroen")
            m["route"] = derived_route(m["req"], m["resp"])
        temp_label = {
            "013C": "Tyre temperature front left",
            "013D": "Tyre temperature front right",
            "013E": "Tyre temperature rear left",
            "013F": "Tyre temperature rear right",
        }
        for k in b["known_dids"]:
            k["source"] = S("obdb_citroen")
            if k["did"] == "012F":
                k["decodes"] = [
                    dec(0, 1, 1.0, 0.0, "flag", "flag", "TPMS rear-left pressure invalid", encoding="bitfield", bit_offset=3, bit_len=1),
                    dec(0, 1, 1.0, 0.0, "flag", "flag", "TPMS rear-right pressure invalid", encoding="bitfield", bit_offset=2, bit_len=1),
                    dec(0, 1, 1.0, 0.0, "flag", "flag", "TPMS front-right pressure invalid", encoding="bitfield", bit_offset=1, bit_len=1),
                    dec(0, 1, 1.0, 0.0, "flag", "flag", "TPMS front-left pressure invalid", encoding="bitfield", bit_offset=0, bit_len=1),
                ]
                # scalar mirror stays the whole byte: offset 0, len 1, raw flags
                k["decodes"].insert(0, dec(0, 1, 1.0, 0.0, "", "raw", k["label"]))
            else:
                k["decodes"] = [
                    dec(0, 2, 0.001, 0.0, "bar", "pressure", k["label"]),
                    dec(2, 1, 1.0, -50.0, "C", "temperature", temp_label[k["did"]]),
                ]
                note(f"overlay {k['did']}: tyre temperature at byte 2 (raw - 50 C) imported", f"packs/obdb-citroen.json known_dids[{k['did']}].decodes[1]", "obdb_citroen")
        b["profiled_level"] = "routes_sourced"
        b["sources"] = [S("obdb_citroen")]
    with open(OVERLAY, "w", encoding="utf-8") as fh:
        json.dump(pack, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def main() -> None:
    with open(DATA, encoding="utf-8") as fh:
        m = json.load(fh)
    assert m["version"] == 8, "this script migrates v8 only"
    m["version"] = 9
    m["generated"] = TODAY
    m["note"] = (
        "v9 (2026-08-28, multi-brand plan Phase 1): every module, band, known DID, family and decode carries a source "
        "{url, date, type, licence}; brands carry read_service, identity_block (layouts name encodings, never brands), "
        "platforms[] (vds_pattern regex on VIN 4-10 only where a registry confirmed it), gateway_behaviour, profiled_level and sources[]; "
        "modules carry route tuples (protocol, req, resp, target_byte, address_extension, gateway) and per-module read_service overrides; "
        "known_dids carry decodes[] (multi-value, signed, be/le/bcd/ascii/bitfield) with the old offset/len/scale/bias kept as a mirror of decodes[0], "
        "and are module-bound or marked binding: unknown; the F4xx mode-01 mirror band is low everywhere. "
        "See docs/uds/migration-v9.md for every migrated fact and packages/uds-map/COVERAGE.md (generated by pnpm coverage). "
        + m["note"]
    )
    m["standard"]["read_service"] = "22"
    m["standard"]["identity_block"] = {"dids": deepcopy(ISO_IDENTITY), "source": S("opendbc_uds")}
    m["brands"] = [migrate_brand(b) for b in m["brands"]]
    migrate_families(m.get("ecu_families", []))
    with open(DATA, "w", encoding="utf-8") as fh:
        json.dump(m, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    migrate_overlay()
    write_log()


def write_log() -> None:
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    lines = [
        "# uds-map v9 migration log",
        "",
        f"Generated {TODAY} by `packages/uds-map/scripts/migrate-v8-to-v9.py` (multi-brand plan, Phase 1, P1.3).",
        "Each row is one fact that lived only as prose in `packages/uds-map/RESEARCH.md` (or in an entry's label/note text)",
        "and now lives in `data/uds-map.json` at the JSON path shown, with the source it carries.",
        "`research:<anchor>` means the fact's only citation is that RESEARCH.md section (`type: community`).",
        "`derived` means the value was derived from what the pack holds (see `docs/uds/pack-schema-v9.md`).",
        "",
        "| Fact | JSON path | Source |",
        "|---|---|---|",
    ]
    for fact, path, sid in log:
        lines.append(f"| {fact} | `{path}` | {sid} |")
    lines += [
        "",
        "## Facts not migrated (and why)",
        "",
        "See the list at the end of `docs/uds/pack-schema-v9.md`.",
        "",
    ]
    with open(LOG, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    main()
