//! Identity confidence write-back (plan A7). The supervisor's fingerprint
//! write-back is not owned by this track, so the entry point lives here and
//! is wired in as a one-line follow-up:
//! `discovery::identity::record_identity(&db, module_id, &fingerprint)`
//! right after `db.update_ecu_fingerprint(...)`.
//!
//! Until that line lands nothing in the binary calls this module (only the
//! tests do), hence the explicit allow — the alternative would be editing
//! `supervisor.rs`, which this track must not do.
#![allow(dead_code)]

use crate::db::Db;
use crate::elm::discovery::state::IdentityFit;
use crate::elm::uds::EcuFingerprint;

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

/// Record one identity read for a module. Returns the resulting fit, or
/// None when the fingerprint carries no comparison material (a silent or
/// refused identity block must not count as a read) or the module is
/// unknown.
pub fn record_identity(
    db: &Db,
    module_id: i64,
    fingerprint: &EcuFingerprint,
) -> Option<(IdentityFit, i64)> {
    let hash = fingerprint_key_hash(fingerprint)?;
    db.record_identity(module_id, &hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fingerprint(key: Option<&str>) -> EcuFingerprint {
        EcuFingerprint {
            request_address: "6AD".into(),
            response_address: "68D".into(),
            spare_part_number: Some("9846124980".into()),
            hardware_version: None,
            software_version: Some("9695041580".into()),
            system_name: None,
            match_key: key.map(str::to_string),
            fields_answered: 2,
            fields_total: 4,
            evidence: Vec::new(),
        }
    }

    #[test]
    fn two_identical_reads_make_identity_stable_and_a_mismatch_conflicts() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", Some("ABS / ESP"));
        let fp = fingerprint(Some("part=9846124980|sw=9695041580"));
        assert_eq!(
            record_identity(&db, module, &fp),
            Some((IdentityFit::Provisional, 1))
        );
        assert_eq!(
            record_identity(&db, module, &fp),
            Some((IdentityFit::Stable, 2))
        );
        let other = fingerprint(Some("part=9846124980|sw=9600000080"));
        assert_eq!(
            record_identity(&db, module, &other),
            Some((IdentityFit::Conflicted, 3))
        );
        let row = &db.discovered_summary(vehicle)[0];
        assert_eq!(row.identity_fit.as_deref(), Some("conflicted"));
        assert_eq!(row.identity_reads, 3);
    }

    #[test]
    fn a_fingerprint_without_material_does_not_count_as_a_read() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let (vehicle, _) = db.ensure_vehicle("VR7EXAMPLE0000001");
        let module = db.upsert_discovered_module(vehicle, "6AD/68D", None);
        assert_eq!(record_identity(&db, module, &fingerprint(None)), None);
        assert_eq!(record_identity(&db, module, &fingerprint(Some("  "))), None);
        assert_eq!(
            record_identity(&db, 999, &fingerprint(Some("part=1"))),
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
