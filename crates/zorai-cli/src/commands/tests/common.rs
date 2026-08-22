#[cfg(target_os = "linux")]
use std::path::Path;

use zorai_protocol::{AGENT_ID_RAROG, AGENT_ID_SWAROG};

use crate::commands::common::{
    handle_post_setup_action, resolve_dm_target, resolve_gui_binary, resolve_sibling_binary,
    LaunchTarget,
};
#[cfg(target_os = "linux")]
use crate::commands::common::{linux_electron_needs_no_sandbox, ChromeSandboxStatus};
use crate::setup_wizard::PostSetupAction;

#[test]
fn resolve_dm_target_prefers_rarog_routes() {
    assert_eq!(resolve_dm_target(false, true, false, false), AGENT_ID_RAROG);
    assert_eq!(resolve_dm_target(false, false, false, true), AGENT_ID_RAROG);
}

#[test]
fn resolve_dm_target_defaults_to_swarog_routes() {
    assert_eq!(
        resolve_dm_target(true, false, false, false),
        AGENT_ID_SWAROG
    );
    assert_eq!(
        resolve_dm_target(false, false, true, false),
        AGENT_ID_SWAROG
    );
    assert_eq!(
        resolve_dm_target(false, false, false, false),
        AGENT_ID_SWAROG
    );
}

#[test]
fn handle_post_setup_action_maps_launch_targets() {
    assert_eq!(
        handle_post_setup_action(PostSetupAction::LaunchTui),
        Some(LaunchTarget::Tui)
    );
    assert_eq!(
        handle_post_setup_action(PostSetupAction::LaunchElectron),
        Some(LaunchTarget::Gui)
    );
    assert_eq!(handle_post_setup_action(PostSetupAction::NotNow), None);
}

#[test]
fn resolve_sibling_binary_prefers_current_exe_directory() {
    let temp_dir = std::env::temp_dir().join(format!(
        "zorai-cli-common-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");

    let current_exe = temp_dir.join(if cfg!(windows) { "zorai.exe" } else { "zorai" });
    let daemon = temp_dir.join(if cfg!(windows) {
        "zorai-daemon.exe"
    } else {
        "zorai-daemon"
    });

    std::fs::write(&current_exe, []).expect("write current exe");
    std::fs::write(&daemon, []).expect("write daemon binary");

    let resolved = resolve_sibling_binary(Some(current_exe.as_path()), "zorai-daemon");
    assert_eq!(resolved, daemon);

    std::fs::remove_dir_all(temp_dir).expect("remove temp dir");
}

#[cfg(target_os = "linux")]
#[test]
fn resolve_gui_binary_finds_development_linux_unpacked_app_from_repo_root() {
    let temp_dir = std::env::temp_dir().join(format!(
        "zorai-cli-gui-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    let bin_dir = temp_dir.join("bin");
    let gui_dir = temp_dir
        .join("frontend")
        .join("release")
        .join("linux-unpacked");
    std::fs::create_dir_all(&bin_dir).expect("create bin dir");
    std::fs::create_dir_all(&gui_dir).expect("create gui dir");

    let current_exe = bin_dir.join("zorai");
    let gui_binary = gui_dir.join("zorai");
    std::fs::write(&current_exe, []).expect("write current exe");
    std::fs::write(&gui_binary, []).expect("write gui binary");

    let resolved = resolve_gui_binary(None, Some(current_exe.as_path()), Some(temp_dir.as_path()));
    assert_eq!(resolved, gui_binary);

    std::fs::remove_dir_all(temp_dir).expect("remove temp dir");
}

#[cfg(target_os = "linux")]
#[test]
fn linux_electron_needs_no_sandbox_for_extensionless_installed_appimage() {
    let temp_dir = std::env::temp_dir().join(format!(
        "zorai-cli-appimage-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    ));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let gui_binary = temp_dir.join("zorai-desktop");
    std::fs::write(&gui_binary, b"\x7fELF\x02\x01\x01\x00AI\x02").expect("write AppImage header");

    assert!(
        linux_electron_needs_no_sandbox(&gui_binary, ChromeSandboxStatus::Missing),
        "npm and shell releases rename the AppImage to extensionless zorai-desktop"
    );

    std::fs::remove_dir_all(temp_dir).expect("remove temp dir");
}

#[cfg(target_os = "linux")]
#[test]
fn linux_electron_needs_no_sandbox_when_helper_exists_without_root_setuid() {
    assert!(
        linux_electron_needs_no_sandbox(
            Path::new("/tmp/.mount_zorai-QmzCNx/zorai-0.9.45.AppImage"),
            ChromeSandboxStatus::Missing,
        ),
        "AppImages cannot preserve a root-owned setuid helper after their temporary mount"
    );
    assert!(
        !linux_electron_needs_no_sandbox(
            Path::new("/opt/zorai/zorai"),
            ChromeSandboxStatus::Missing,
        ),
        "missing chrome-sandbox should keep Chromium user-namespace sandbox"
    );
    assert!(
        !linux_electron_needs_no_sandbox(
            Path::new("/opt/zorai/zorai"),
            ChromeSandboxStatus::Present {
                uid: 0,
                mode: 0o4755,
            },
        ),
        "a root-owned 4755 helper is the configuration Chromium requires"
    );
    assert!(
        linux_electron_needs_no_sandbox(
            Path::new("/opt/zorai/zorai"),
            ChromeSandboxStatus::Present {
                uid: 0,
                mode: 0o0755,
            },
        ),
        "Chromium aborts if chrome-sandbox exists without the setuid bit"
    );
    assert!(
        linux_electron_needs_no_sandbox(
            Path::new("/opt/zorai/zorai"),
            ChromeSandboxStatus::Present {
                uid: 1000,
                mode: 0o4755,
            },
        ),
        "Chromium aborts if chrome-sandbox is setuid but not owned by root"
    );
}
