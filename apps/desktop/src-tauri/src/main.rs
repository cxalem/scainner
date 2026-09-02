// Windows otherwise opens a second console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    scainner_lib::run()
}
