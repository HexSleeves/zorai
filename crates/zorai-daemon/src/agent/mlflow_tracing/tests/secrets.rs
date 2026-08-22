use super::super::*;

#[test]
fn custom_headers_are_encrypted_and_names_are_listable() {
    let dir = tempfile::tempdir().unwrap();
    let store = MlflowHeaderSecretStore::new(dir.path());
    store.set("Authorization", "Bearer private").unwrap();
    let disk = std::fs::read(dir.path().join("mlflow-tracing-headers.enc")).unwrap();
    assert!(!String::from_utf8_lossy(&disk).contains("private"));
    assert_eq!(
        store.load_all().unwrap().get("Authorization").unwrap(),
        "Bearer private"
    );
    assert_eq!(store.list_names().unwrap(), vec!["Authorization"]);
    assert!(store.delete("Authorization").unwrap());
    assert!(store.list_names().unwrap().is_empty());
}

#[test]
fn invalid_custom_headers_are_rejected_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let store = MlflowHeaderSecretStore::new(dir.path());
    assert!(store.set("Bad Header", "value").is_err());
    assert!(store.set("X-Test", "unsafe\nvalue").is_err());
    assert!(!dir.path().join("mlflow-tracing-headers.enc").exists());
}

#[cfg(unix)]
#[test]
fn encrypted_header_file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let store = MlflowHeaderSecretStore::new(dir.path());
    store.set("X-Test", "value").unwrap();
    let mode = std::fs::metadata(dir.path().join("mlflow-tracing-headers.enc"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600);
}
