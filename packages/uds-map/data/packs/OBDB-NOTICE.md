# OBDb Citroen overlay

`obdb-citroen.json` is adapted from:

- Project: OBDb/Citroen
- Source: `signalsets/v3/default.json`
- Commit: `11a539aaf695097b03bedd9a568170c44a912df3`
- Source URL: https://github.com/OBDb/Citroen/blob/11a539aaf695097b03bedd9a568170c44a912df3/signalsets/v3/default.json
- License: CC BY-SA 4.0
- License URL: https://creativecommons.org/licenses/by-sa/4.0/

Changes made by Scainner: selected the TPMS module and pressure/validity
signals, normalized them into Scainner's module/DID schema, and omitted the
temperature signals until the application supports multiple decoded values
from one DID payload.

This overlay remains a separate file so its share-alike terms and provenance
are explicit. Scainner's project-owned `uds-map.json` does not contain these
adapted entries.
