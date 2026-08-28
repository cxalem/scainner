# OBDb Citroen overlay

`obdb-citroen.json` is adapted from:

- Project: OBDb/Citroen
- Source: `signalsets/v3/default.json`
- Commit: `11a539aaf695097b03bedd9a568170c44a912df3`
- Source URL: https://github.com/OBDb/Citroen/blob/11a539aaf695097b03bedd9a568170c44a912df3/signalsets/v3/default.json
- License: CC BY-SA 4.0
- License URL: https://creativecommons.org/licenses/by-sa/4.0/

Changes made by Scainner: selected the TPMS module and its pressure,
temperature and validity signals and normalized them into Scainner's
module/DID schema (v9 `decodes[]`): each pressure DID (`013C`–`013F`)
carries the pressure (16-bit, bar) and the tyre temperature (byte 2,
raw − 50 °C) as two decodes; `012F` carries the four per-wheel validity
flags as bit fields. Every entry cites this source with its licence.

This overlay remains a separate file so its share-alike terms and provenance
are explicit. Scainner's project-owned `uds-map.json` does not contain these
adapted entries.

# OBDb test cases in the replay corpus

The replay fixtures under `apps/desktop/src-tauri/tests/fixtures/{brand}/{platform}/{shape}/`
(every directory except `psa/` and the synthetic `elm/`) are adapted from the
`tests/test_cases/<year>/commands/*.yaml` files and `signalsets/v3/*.json`
definitions of these OBDb repositories, each at the commit recorded per
fixture in `docs/uds/CORPUS.md` and in every `*.expected.json` sidecar:

- Project: OBDb (https://github.com/OBDb), repositories `Acura-TLX`, `BMW-i3`,
  `Chrysler-Pacifica`, `Cupra-Born`, `FIAT-500X`, `Ford-F-150-Lightning`,
  `GMC-Canyon`, `Hyundai-Elantra`, `Hyundai-Kona-Electric`, `Kia-Niro-EV`,
  `Lexus-RX`, `MINI-Countryman`, `Nissan-Leaf`, `Ram-2500`, `Toyota-Camry`,
  `Toyota-Prius`, together with the brand-level
  signalsets `Acura`, `BMW`, `Chrysler`, `Cupra`, `FIAT`, `Ford`, `GMC`,
  `Hyundai`, `Kia`, `Lexus`, `MINI`, `Nissan`, `Ram`, `Toyota` and `SAEJ1979`.
- License: CC BY-SA 4.0
- License URL: https://creativecommons.org/licenses/by-sa/4.0/

Changes made by Scainner: the recorded ISO-TP frames were reassembled into
one application message per case, rendered as the ELM327 `ATCAF1 ATH0`
output the app reads, and paired with the recorded expected values; only
cases whose expected values reproduce from the signal definitions were kept.
The conversion is `scripts/import_obdb_fixtures.py` with `scripts/SELECTION.json`.

# opendbc identification strings in the replay corpus

The `svc1a` and `ascii` fixtures (and the `ext-addr` fixtures whose sidecar
says `synthetic_framing: true`) wrap ECU identification strings from:

- Project: commaai/opendbc (https://github.com/commaai/opendbc)
- Source: `opendbc/car/{toyota,honda,hyundai}/fingerprints.py` (`FW_VERSIONS`)
- Commit: `7343a66d46213d5f73528afc6c6db713ebd88a9d`
- License: MIT
- License URL: https://github.com/commaai/opendbc/blob/7343a66d46213d5f73528afc6c6db713ebd88a9d/LICENSE

Changes made by Scainner: each stored payload was prefixed with the positive
response of the query opendbc issues for that brand and split into synthetic
ISO-TP frames; the strings themselves are unchanged.
