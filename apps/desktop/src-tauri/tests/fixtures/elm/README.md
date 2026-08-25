# ELM replay fixtures

These fixtures exercise scanner workflows through the same `ElmDriver::cmd`
boundary used by a real adapter. Steps are ordered deliberately: an unexpected,
missing, or additional command fails the replay instead of returning a convenient
stubbed value.

## Capture and redaction rules

Fixtures may preserve protocol framing, line breaks, negative response codes,
timeouts, and payload shapes. Before committing a capture, remove or replace:

- VINs and registration numbers;
- ECU and TPMS sensor serial numbers;
- Bluetooth MAC addresses and serial-device paths;
- customer names, workshop names, and free-text complaints;
- timestamps or identifiers that can be joined back to a customer record.

Set `contains_vehicle_identifiers` to `false` only after reviewing the complete
file. The replay loader rejects a fixture marked as containing identifiers. Use
obviously artificial values when the shape of an identity response is required.

Use `error: "no_response"` for real silence, not a textual `NO DATA` response.
The distinction matters: `NO DATA\r>` is bytes returned by a functioning ELM,
whereas `no_response` represents an adapter or link timeout.

The fixture format is schema-versioned. Changes that alter command matching or
response semantics must increment `schema_version` and retain a migration or
explicit compatibility path for old captures.
