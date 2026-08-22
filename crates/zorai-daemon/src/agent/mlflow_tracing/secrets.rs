use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const HEADER_FILE: &str = "mlflow-tracing-headers.enc";

#[derive(Debug, Clone)]
pub struct MlflowHeaderSecretStore {
    data_dir: PathBuf,
}

impl MlflowHeaderSecretStore {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            data_dir: data_dir.as_ref().to_path_buf(),
        }
    }

    pub fn set(&self, name: &str, value: &str) -> Result<()> {
        validate_header(name, value)?;
        let mut headers = self.load_all()?;
        headers.insert(name.to_string(), value.to_string());
        self.write_all(&headers)
    }

    pub fn delete(&self, name: &str) -> Result<bool> {
        let mut headers = self.load_all()?;
        let removed = headers.remove(name).is_some();
        if removed {
            self.write_all(&headers)?;
        }
        Ok(removed)
    }

    pub fn list_names(&self) -> Result<Vec<String>> {
        Ok(self.load_all()?.into_keys().collect())
    }

    pub fn load_all(&self) -> Result<BTreeMap<String, String>> {
        let path = self.path();
        if !path.exists() {
            return Ok(BTreeMap::new());
        }
        let key = crate::plugin::crypto::load_or_create_key(&self.data_dir)?;
        let encrypted = std::fs::read(&path)
            .with_context(|| format!("failed to read MLflow header store: {}", path.display()))?;
        let plaintext = crate::plugin::crypto::decrypt(&key, &encrypted)
            .context("failed to decrypt MLflow header store")?;
        serde_json::from_slice(&plaintext).context("failed to parse MLflow header store")
    }

    fn write_all(&self, headers: &BTreeMap<String, String>) -> Result<()> {
        std::fs::create_dir_all(&self.data_dir).with_context(|| {
            format!(
                "failed to create MLflow header directory: {}",
                self.data_dir.display()
            )
        })?;
        let key = crate::plugin::crypto::load_or_create_key(&self.data_dir)?;
        let plaintext = serde_json::to_vec(headers)?;
        let encrypted = crate::plugin::crypto::encrypt(&key, &plaintext)?;
        let path = self.path();
        let temporary = self.data_dir.join(format!(".{HEADER_FILE}.tmp"));
        write_private(&temporary, &encrypted)?;
        std::fs::rename(&temporary, &path).with_context(|| {
            format!(
                "failed to atomically replace MLflow header store: {}",
                path.display()
            )
        })?;
        Ok(())
    }

    fn path(&self) -> PathBuf {
        self.data_dir.join(HEADER_FILE)
    }
}

fn validate_header(name: &str, value: &str) -> Result<()> {
    reqwest::header::HeaderName::from_bytes(name.as_bytes())
        .with_context(|| format!("invalid MLflow header name '{name}'"))?;
    reqwest::header::HeaderValue::from_str(value)
        .with_context(|| format!("invalid value for MLflow header '{name}'"))?;
    Ok(())
}

#[cfg(unix)]
fn write_private(path: &Path, content: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(content)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &Path, content: &[u8]) -> Result<()> {
    std::fs::write(path, content)?;
    Ok(())
}
