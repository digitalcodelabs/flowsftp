pub mod profiles;

use keyring::Entry;

pub struct KeychainManager;

impl KeychainManager {
    const SERVICE: &'static str = "termsftp";

    pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
        let entry = Entry::new(Self::SERVICE, account)
            .map_err(|e| format!("Keyring error: {}", e))?;
        entry
            .set_password(secret)
            .map_err(|e| format!("Failed to store secret: {}", e))
    }

    pub fn get_secret(account: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(Self::SERVICE, account)
            .map_err(|e| format!("Keyring error: {}", e))?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Failed to read secret: {}", e)),
        }
    }

    pub fn delete_secret(account: &str) -> Result<(), String> {
        let entry = Entry::new(Self::SERVICE, account)
            .map_err(|e| format!("Keyring error: {}", e))?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to delete secret: {}", e)),
        }
    }
}
