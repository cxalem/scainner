//! Knowledge overlay packs enumerated from data (multi-brand plan P2.5).
//!
//! `packages/uds-map/data/packs.json` lists every overlay under
//! `data/packs/`; this module embeds exactly those files and a test fails
//! when the two lists drift. `include_str!` needs literal paths, so the
//! embedded list is written out here — the index stays the source of truth
//! and the mirror is checked, never trusted. Folding this into
//! `uds_map.rs` (whose single-overlay functions keep working unchanged) is
//! the Phase 1 follow-up recorded in the PR.

use crate::elm::uds_map::{can_address, hex16, Brand, KnownDid};
use serde::Deserialize;
use std::sync::OnceLock;

const INDEX_RAW: &str = include_str!("../../../../../../packages/uds-map/data/packs.json");

/// (file name as listed in the index, embedded contents).
const EMBEDDED: &[(&str, &str)] = &[(
    "obdb-citroen.json",
    include_str!("../../../../../../packages/uds-map/data/packs/obdb-citroen.json"),
)];

#[derive(Deserialize)]
struct PackIndex {
    packs: Vec<String>,
}

#[derive(Deserialize)]
pub struct OverlayPack {
    pub id: String,
    pub version: u32,
    pub license: String,
    pub source: String,
    pub brands: Vec<Brand>,
}

fn index() -> &'static PackIndex {
    static INDEX: OnceLock<PackIndex> = OnceLock::new();
    INDEX.get_or_init(|| serde_json::from_str(INDEX_RAW).expect("data/packs.json is malformed"))
}

/// Every overlay pack the index lists, in index order.
pub fn overlays() -> &'static [OverlayPack] {
    static PACKS: OnceLock<Vec<OverlayPack>> = OnceLock::new();
    PACKS.get_or_init(|| {
        index()
            .packs
            .iter()
            .map(|name| {
                let (_, raw) = EMBEDDED
                    .iter()
                    .find(|(file, _)| file == name)
                    .unwrap_or_else(|| {
                        panic!("data/packs.json lists {name} but packs.rs does not embed it")
                    });
                let pack: OverlayPack = serde_json::from_str(raw)
                    .unwrap_or_else(|e| panic!("data/packs/{name} is malformed: {e}"));
                assert!(
                    pack.version > 0,
                    "{name}: overlay versions must be positive"
                );
                assert!(!pack.license.is_empty(), "{name}: overlay without licence");
                assert!(!pack.source.is_empty(), "{name}: overlay without source");
                pack
            })
            .collect()
    })
}

/// Overlay brand entries whose WMI list contains this VIN's prefix.
pub fn overlay_brands_for_vin(vin: Option<&str>) -> Vec<&'static Brand> {
    let Some(wmi) = vin.filter(|v| v.len() >= 3).map(|v| v[..3].to_uppercase()) else {
        return Vec::new();
    };
    overlays()
        .iter()
        .flat_map(|p| &p.brands)
        .filter(|b| b.wmi.iter().any(|w| w.eq_ignore_ascii_case(&wmi)))
        .collect()
}

/// Module address pairs for a VIN: the main map's (which already include
/// the first overlay through the frozen contract) followed by every other
/// overlay's, deduplicated.
pub fn known_modules_for_vin(vin: Option<&str>) -> Vec<(u32, u32, Option<String>)> {
    let mut out = crate::elm::uds_map::known_modules_for_vin(vin);
    for brand in overlay_brands_for_vin(vin) {
        for module in &brand.modules {
            let (Some(req), Some(resp)) = (can_address(&module.req), can_address(&module.resp))
            else {
                continue;
            };
            if !out.iter().any(|(r, s, _)| *r == req && *s == resp) {
                out.push((req, resp, module.name.clone()));
            }
        }
    }
    out
}

/// A module-bound known DID from any overlay (after the main map missed).
pub fn overlay_known_did(
    vin: Option<&str>,
    req: u32,
    resp: u32,
    did: u16,
) -> Option<&'static KnownDid> {
    overlay_brands_for_vin(vin)
        .into_iter()
        .flat_map(|b| &b.known_dids)
        .filter(|k| hex16(&k.did) == Some(did))
        .find(|k| {
            k.modules
                .iter()
                .any(|m| can_address(&m.req) == Some(req) && can_address(&m.resp) == Some(resp))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_index_and_the_embedded_list_match_exactly() {
        let listed: Vec<&str> = index().packs.iter().map(String::as_str).collect();
        let embedded: Vec<&str> = EMBEDDED.iter().map(|(f, _)| *f).collect();
        assert_eq!(listed, embedded, "data/packs.json and packs.rs drifted");
        let dir: Vec<String> = std::fs::read_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/uds-map/data/packs"
        ))
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
        for file in &dir {
            assert!(
                listed.contains(&file.as_str()),
                "{file} is not in data/packs.json"
            );
        }
        assert_eq!(overlays().len(), listed.len());
    }

    #[test]
    fn overlays_are_selected_by_wmi_and_add_modules() {
        let pack = &overlays()[0];
        let brand = &pack.brands[0];
        let vin = format!("{}EXAMPLE0000001", brand.wmi[0]);
        assert!(!overlay_brands_for_vin(Some(&vin)).is_empty());
        let modules = known_modules_for_vin(Some(&vin));
        for module in &brand.modules {
            let (req, resp) = (
                can_address(&module.req).unwrap(),
                can_address(&module.resp).unwrap(),
            );
            assert!(modules.iter().any(|(r, s, _)| *r == req && *s == resp));
            if let Some(known) = brand.known_dids.first() {
                assert!(
                    overlay_known_did(Some(&vin), req, resp, hex16(&known.did).unwrap()).is_some()
                );
            }
        }
        assert!(overlay_brands_for_vin(Some("ZZZ00000000000000")).is_empty());
        assert!(overlay_brands_for_vin(None).is_empty());
    }
}
