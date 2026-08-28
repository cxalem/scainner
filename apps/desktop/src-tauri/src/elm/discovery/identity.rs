//! Identity: the one fingerprint builder (multi-brand plan P2.3) and the
//! identity-confidence write-back (plan A7).
//!
//! [`fingerprint`] is driven entirely by the brand's `identity_block`
//! (`uds_map::identity_block_for_vin`): it walks the block's DIDs in order
//! (ISO first, vendor layouts after), decodes each answered payload with
//! the entry's layout — `iso_ascii`, `bcd_part_refs`, `ascii_part_refs`,
//! `raw`; layouts name encodings, never brands — and fills the part,
//! hardware, software, system and supplier fields. The first decoded value
//! of a field wins, so an ISO answer is preferred over a vendor one.
//! `serial`, `vin` and `other` entries are kept as evidence and never
//! enter the match key.

use crate::db::Db;
use crate::elm::discovery::state::IdentityFit;
use crate::elm::outcome::{DiagnosticOutcome, DiagnosticStatus};
use crate::elm::uds::{EcuFingerprint, EcuIdentityEvidence};
use crate::elm::uds_map::{self, hex16, IdentityBlock, IdentityDid, IdentityField, IdentityLayout};

/// One identity DID as read on a route: the outcome plus the payload after
/// the echoed identifier.
#[derive(Debug, Clone)]
pub struct IdentityObservation {
    pub did: u16,
    pub outcome: DiagnosticOutcome,
    pub payload: Vec<u8>,
}

impl IdentityObservation {
    pub fn answered(&self) -> bool {
        self.outcome.status == DiagnosticStatus::Answered
    }
}

/// Packed BCD digits: `len` bytes at `offset`, two decimal digits per byte,
/// wrapped in a literal `prefix`/`suffix`. `None` when the group is short
/// or any nibble is not a decimal digit, so `FF` padding never becomes a
/// number.
pub fn decode_bcd_part_refs(
    payload: &[u8],
    offset: usize,
    len: usize,
    prefix: &str,
    suffix: &str,
) -> Option<String> {
    let group = payload.get(offset..offset.checked_add(len)?)?;
    if group.is_empty() {
        return None;
    }
    let mut digits = String::with_capacity(prefix.len() + len * 2 + suffix.len());
    digits.push_str(prefix);
    for byte in group {
        let (high, low) = (byte >> 4, byte & 0x0F);
        if high > 9 || low > 9 {
            return None;
        }
        digits.push(char::from(b'0' + high));
        digits.push(char::from(b'0' + low));
    }
    digits.push_str(suffix);
    Some(digits)
}

/// Printable ASCII of a slice, NUL/space padding trimmed; `None` when
/// nothing readable is left.
pub fn decode_ascii(payload: &[u8]) -> Option<String> {
    let text: String = payload
        .iter()
        .map(|&b| {
            if (0x20..0x7F).contains(&b) {
                b as char
            } else {
                '\u{0}'
            }
        })
        .collect();
    let clean = text
        .trim_matches(|c: char| c == '\u{0}' || c == ' ')
        .to_string();
    if clean.is_empty() || clean.contains('\u{0}') {
        return None;
    }
    let alnum = clean.chars().filter(|c| c.is_ascii_alphanumeric()).count();
    (alnum >= 2).then_some(clean)
}

/// ASCII references at a fixed offset/length (`ascii_part_refs`).
pub fn decode_ascii_at(payload: &[u8], offset: usize, len: usize) -> Option<String> {
    decode_ascii(payload.get(offset..offset.checked_add(len)?)?)
}

/// Bytes as upper-case hex without separators (`raw`).
pub fn decode_raw(payload: &[u8], offset: usize, len: Option<usize>) -> Option<String> {
    let end = match len {
        Some(len) => offset.checked_add(len)?,
        None => payload.len(),
    };
    let slice = payload.get(offset..end)?;
    if slice.is_empty() || slice.iter().all(|b| *b == 0 || *b == 0xFF) {
        return None;
    }
    Some(slice.iter().map(|b| format!("{b:02X}")).collect())
}

fn decode_entry(entry: &IdentityDid, payload: &[u8]) -> Option<String> {
    let offset = entry.offset.unwrap_or(0) as usize;
    match entry.layout {
        IdentityLayout::IsoAscii => match entry.len {
            Some(len) => decode_ascii_at(payload, offset, len as usize),
            None => decode_ascii(payload.get(offset..)?),
        },
        IdentityLayout::BcdPartRefs => decode_bcd_part_refs(
            payload,
            offset,
            entry.len? as usize,
            entry.prefix.as_deref().unwrap_or(""),
            entry.suffix.as_deref().unwrap_or(""),
        ),
        IdentityLayout::AsciiPartRefs => decode_ascii_at(payload, offset, entry.len? as usize),
        IdentityLayout::Raw => decode_raw(payload, offset, entry.len.map(|l| l as usize)),
    }
}

fn field_name(field: IdentityField) -> &'static str {
    match field {
        IdentityField::Part => "part",
        IdentityField::Hardware => "hardware",
        IdentityField::Software => "software",
        IdentityField::System => "system",
        IdentityField::Serial => "serial",
        IdentityField::Supplier => "supplier",
        IdentityField::Vin => "vin",
        IdentityField::Other => "other",
    }
}

fn layout_name(layout: IdentityLayout) -> &'static str {
    match layout {
        IdentityLayout::IsoAscii => "iso_ascii",
        IdentityLayout::BcdPartRefs => "bcd_part_refs",
        IdentityLayout::AsciiPartRefs => "ascii_part_refs",
        IdentityLayout::Raw => "raw",
    }
}

fn hex_string(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build the fingerprint of one route from the identity block of this
/// VIN's brand. `None` when no comparable field (part, hardware, software,
/// system) could be decoded — a silent or refused block never produces a
/// fingerprint.
pub fn fingerprint(
    vin: Option<&str>,
    route: (&str, &str),
    observations: &[IdentityObservation],
) -> Option<EcuFingerprint> {
    fingerprint_with_block(&uds_map::identity_block_for_vin(vin), route, observations)
}

/// Same as [`fingerprint`] with an explicit block (tests, replay tooling).
pub fn fingerprint_with_block(
    block: &IdentityBlock,
    (req, resp): (&str, &str),
    observations: &[IdentityObservation],
) -> Option<EcuFingerprint> {
    let mut part = None;
    let mut hardware = None;
    let mut software = None;
    let mut system = None;
    let mut supplier = None;
    // Evidence: one entry per DID of the block that was observed, with every
    // field decoded from it.
    let mut evidence: Vec<EcuIdentityEvidence> = Vec::new();
    for entry in &block.dids {
        let Some(did) = hex16(&entry.did) else {
            continue;
        };
        let Some(observation) = observations.iter().find(|o| o.did == did) else {
            continue;
        };
        let decoded = observation
            .answered()
            .then(|| decode_entry(entry, &observation.payload))
            .flatten();
        let excluded = matches!(
            entry.field,
            IdentityField::Serial | IdentityField::Vin | IdentityField::Other
        );
        let description = format!(
            "{} ({}){}",
            field_name(entry.field),
            layout_name(entry.layout),
            if excluded {
                ", excluded from the match key"
            } else {
                ""
            }
        );
        match evidence.iter_mut().find(|e| e.did == did) {
            Some(existing) => {
                existing.label.push_str("; ");
                existing.label.push_str(&description);
                if let Some(value) = &decoded {
                    existing.decoded_value = Some(match &existing.decoded_value {
                        Some(previous) => format!("{previous} / {value}"),
                        None => value.clone(),
                    });
                }
            }
            None => evidence.push(EcuIdentityEvidence {
                did,
                label: description,
                outcome: observation.outcome.clone(),
                raw_value: observation
                    .answered()
                    .then(|| hex_string(&observation.payload)),
                decoded_value: decoded.clone(),
            }),
        }
        let Some(value) = decoded else {
            continue;
        };
        let slot = match entry.field {
            IdentityField::Part => &mut part,
            IdentityField::Hardware => &mut hardware,
            IdentityField::Software => &mut software,
            IdentityField::System => &mut system,
            IdentityField::Supplier => &mut supplier,
            IdentityField::Serial | IdentityField::Vin | IdentityField::Other => continue,
        };
        if slot.is_none() {
            *slot = Some(value);
        }
    }
    let comparable = [
        ("part", part.as_deref()),
        ("hw", hardware.as_deref()),
        ("sw", software.as_deref()),
        ("sys", system.as_deref()),
    ];
    let fields_answered = comparable.iter().filter(|(_, v)| v.is_some()).count() as u8;
    if fields_answered == 0 {
        return None;
    }
    let match_key = comparable
        .iter()
        .filter_map(|(name, value)| value.map(|v| format!("{name}={v}")))
        .collect::<Vec<_>>()
        .join("|");
    Some(EcuFingerprint {
        request_address: req.trim().into(),
        response_address: resp.trim().into(),
        spare_part_number: part,
        hardware_version: hardware,
        software_version: software,
        system_name: system,
        supplier,
        match_key: Some(match_key),
        fields_answered,
        fields_total: 4,
        evidence,
    })
}

/// Digest of the comparison material only: part / hardware / software /
/// system name. The ECU serial and the VIN never enter it, so two reads
/// agree exactly when the *family* material is byte-identical.
pub fn fingerprint_key_hash(fingerprint: &EcuFingerprint) -> Option<String> {
    let key = fingerprint.match_key.as_deref()?.trim();
    if key.is_empty() {
        return None;
    }
    Some(hash_key(key))
}

/// Stable digest of an arbitrary match key string. FNV-1a 64 written out
/// rather than `DefaultHasher`, whose algorithm is not guaranteed across
/// Rust releases — the hash is persisted, and a toolchain change must not
/// turn every stable module into a conflicted one.
pub fn hash_key(key: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Record one identity read for a module on `connection_id`. Stable needs
/// the same material on a second, independent connection. Returns the
/// resulting fit, or None when the fingerprint carries no comparison
/// material (a silent or refused identity block must not count as a read)
/// or the module is unknown.
pub fn record_identity(
    db: &Db,
    module_id: i64,
    fingerprint: &EcuFingerprint,
    connection_id: i64,
) -> Option<(IdentityFit, i64)> {
    let hash = fingerprint_key_hash(fingerprint)?;
    db.record_identity(module_id, &hash, connection_id)
}

#[cfg(test)]
pub(crate) mod test_data {
    //! Identity payloads captured on this project's verified vehicle
    //! (evidence run #2, 2026-08-27) and a synthetic ISO block. Test data,
    //! not production constants.
    use super::IdentityObservation;
    use crate::elm::outcome::DiagnosticOutcome;

    pub fn answered(did: u16, hex: &str) -> IdentityObservation {
        IdentityObservation {
            did,
            outcome: DiagnosticOutcome::answered("22"),
            payload: crate::elm::discovery::join::parse_hex(hex),
        }
    }

    pub fn silent(did: u16) -> IdentityObservation {
        IdentityObservation {
            did,
            outcome: DiagnosticOutcome::timed_out("22"),
            payload: Vec::new(),
        }
    }

    /// The verified vehicle's ABS/ESP as it answered its vendor block.
    pub fn verified_abs_observations() -> Vec<IdentityObservation> {
        vec![
            answered(0xF18C, "32 38 35"),
            answered(0xF080, "98 46 12 49 80 00 0D 98 20 60 93 80 70 12"),
            answered(
                0xF0FE,
                "FF FF 00 00 0D 56 09 02 16 30 15 11 01 FF FF FF 00 02 00 00 01 95 04 15",
            ),
        ]
    }

    /// A module of a brand with only the ISO block: F187/F191/F195/F197.
    pub fn iso_observations() -> Vec<IdentityObservation> {
        vec![
            answered(0xF187, "31 4B 30 39 30 37 35 33 30 41"),
            answered(0xF191, "48 30 31"),
            answered(0xF195, "30 32 31 30"),
            answered(0xF197, "45 53 43 20 4D 4B 31 30 30"),
            answered(0xF18C, "53 45 52 49 41 4C 31"),
            answered(0xF190, "5A 5A 5A 30 30 30 30 30 30 30 30 30 30 30 30 30 31"),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::test_data::*;
    use super::*;
    use crate::elm::discovery::pack_ext::tests::verified_brand_vin;
    use crate::elm::uds_map::map;

    fn fingerprint(key: Option<&str>) -> EcuFingerprint {
        EcuFingerprint {
            request_address: "6AD".into(),
            response_address: "68D".into(),
            spare_part_number: Some("9846124980".into()),
            hardware_version: None,
            software_version: Some("9695041580".into()),
            system_name: None,
            supplier: None,
            match_key: key.map(str::to_string),
            fields_answered: 2,
            fields_total: 4,
            evidence: Vec::new(),
        }
    }

    #[test]
    fn the_verified_vehicle_payloads_still_yield_the_known_references() {
        let vin = verified_brand_vin();
        let fp = super::fingerprint(Some(&vin), ("6AD", "68D"), &verified_abs_observations())
            .expect("vendor block answered");
        assert_eq!(fp.spare_part_number.as_deref(), Some("9846124980"));
        assert_eq!(fp.hardware_version.as_deref(), Some("9820609380"));
        assert_eq!(fp.software_version.as_deref(), Some("9695041580"));
        assert_eq!(
            fp.match_key.as_deref(),
            Some("part=9846124980|hw=9820609380|sw=9695041580")
        );
        assert_eq!(fp.supplier.as_deref(), Some("0D"));
        assert_eq!(fp.fields_answered, 3);
        assert!(
            !fp.match_key.unwrap().contains("285"),
            "serial never in the key"
        );
        assert!(fp
            .evidence
            .iter()
            .any(|e| e.did == 0xF18C && e.label.contains("excluded")));
        // The family join sees the same tuple the old parser produced.
        let key = crate::elm::discovery::family::CompatibilityKey::from_fingerprint(
            fp.spare_part_number.as_deref(),
            fp.software_version.as_deref(),
            fp.system_name.as_deref(),
            fp.supplier.as_deref(),
            "22",
        );
        assert_eq!(
            crate::elm::discovery::family::match_family(&key, map()).as_str(),
            "strong"
        );
    }

    #[test]
    fn an_iso_block_vehicle_of_another_brand_fingerprints_from_f187_f191_f195_f197() {
        // A brand with the ISO block only (no vendor entries), by data.
        let brand = map()
            .brands
            .iter()
            .find(|b| {
                b.identity_block.as_ref().is_some_and(|block| {
                    block
                        .dids
                        .iter()
                        .all(|d| d.layout == IdentityLayout::IsoAscii)
                })
            })
            .expect("a brand with an ISO-only identity block");
        let vin = format!("{}EXAMPLE0000002", brand.wmi[0]);
        let fp = super::fingerprint(Some(&vin), ("7E0", "7E8"), &iso_observations()).unwrap();
        assert_eq!(fp.spare_part_number.as_deref(), Some("1K0907530A"));
        assert_eq!(fp.hardware_version.as_deref(), Some("H01"));
        assert_eq!(fp.software_version.as_deref(), Some("0210"));
        assert_eq!(fp.system_name.as_deref(), Some("ESC MK100"));
        assert_eq!(fp.fields_answered, 4);
        let key = fp.match_key.unwrap();
        assert_eq!(key, "part=1K0907530A|hw=H01|sw=0210|sys=ESC MK100");
        assert!(!key.contains("SERIAL1") && !key.contains("ZZZ"));
        // An unknown WMI falls back to the standard ISO block.
        let unknown = super::fingerprint(
            Some("ZZZ00000000000000"),
            ("7E0", "7E8"),
            &iso_observations(),
        )
        .unwrap();
        assert_eq!(unknown.match_key, Some(key));
    }

    #[test]
    fn silent_or_padded_blocks_produce_no_fingerprint() {
        let vin = verified_brand_vin();
        assert!(super::fingerprint(Some(&vin), ("6AD", "68D"), &[silent(0xF080)]).is_none());
        assert!(super::fingerprint(
            Some(&vin),
            ("6AD", "68D"),
            &[answered(0xF080, "FF FF FF FF FF FF FF FF FF FF FF FF")]
        )
        .is_none());
        assert_eq!(decode_bcd_part_refs(&[0xFF; 24], 21, 3, "96", "80"), None);
        assert_eq!(decode_bcd_part_refs(&[0x00; 10], 21, 3, "96", "80"), None);
        assert_eq!(
            decode_bcd_part_refs(&[0x98, 0x17, 0x13, 0x71, 0x80], 0, 5, "", ""),
            Some("9817137180".into())
        );
        assert_eq!(decode_raw(&[0, 0, 0, 0, 0xFF], 4, Some(1)), None);
        assert_eq!(
            decode_raw(&[0, 0, 0, 0, 0x2A], 4, Some(1)),
            Some("2A".into())
        );
    }

    #[test]
    fn identity_is_stable_only_after_an_independent_connection_repeats_it() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle, _) = db.ensure_vehicle(&verified_brand_vin());
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", Some("ABS / ESP"));
        let fp = fingerprint(Some("part=9846124980|sw=9695041580"));
        let first = db.start_connection("ELM327", "test");
        let second = db.start_connection("ELM327", "test");
        assert_eq!(
            record_identity(&db, module, &fp, first),
            Some((IdentityFit::Provisional, 1))
        );
        // Same session again: only proves the buffer, still provisional.
        assert_eq!(
            record_identity(&db, module, &fp, first),
            Some((IdentityFit::Provisional, 2))
        );
        assert_eq!(
            record_identity(&db, module, &fp, second),
            Some((IdentityFit::Stable, 3))
        );
        let other = fingerprint(Some("part=9846124980|sw=9600000080"));
        assert_eq!(
            record_identity(&db, module, &other, second),
            Some((IdentityFit::Conflicted, 4))
        );
        let row = &db.discovered_summary(vehicle)[0];
        assert_eq!(row.identity_fit.as_deref(), Some("conflicted"));
        assert_eq!(row.identity_reads, 4);
    }

    #[test]
    fn a_fingerprint_without_material_does_not_count_as_a_read() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle, _) = db.ensure_vehicle(&verified_brand_vin());
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        assert_eq!(record_identity(&db, module, &fingerprint(None), 1), None);
        assert_eq!(
            record_identity(&db, module, &fingerprint(Some("  ")), 1),
            None
        );
        assert_eq!(
            record_identity(&db, 999, &fingerprint(Some("part=1")), 1),
            None
        );
        assert_eq!(db.discovered_summary(vehicle)[0].identity_reads, 0);
    }

    #[test]
    fn the_hash_is_stable_and_never_the_key_itself() {
        let a = hash_key("part=9846124980|sw=9695041580");
        assert_eq!(a, hash_key("part=9846124980|sw=9695041580"));
        assert_ne!(a, hash_key("part=9846124980"));
        assert!(!a.contains("9846124980"));
        assert_eq!(a.len(), 16);
    }
}
