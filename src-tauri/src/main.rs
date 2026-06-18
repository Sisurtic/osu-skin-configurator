// Prevents additional console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    osu_skin_configurator_lib::run();
}
