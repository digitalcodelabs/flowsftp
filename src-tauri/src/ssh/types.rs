use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum SshAuthMethod {
    Password(String),
    KeyFile {
        path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnectConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: SshAuthMethod,
    #[serde(default = "default_cols")]
    pub cols: u32,
    #[serde(default = "default_rows")]
    pub rows: u32,
    #[serde(default = "default_term")]
    pub term: String,
}

fn default_port() -> u16 {
    22
}

fn default_cols() -> u32 {
    80
}

fn default_rows() -> u32 {
    24
}

fn default_term() -> String {
    "xterm-256color".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResizePayload {
    pub session_id: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInputPayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputPayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default = "default_protocol")]
    pub protocol: String,
}

fn default_protocol() -> String {
    "sftp".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_auth_method_roundtrips_password_keyfile_and_agent() {
        let agent: SshAuthMethod = serde_json::from_str(r#"{"type":"Agent"}"#).unwrap();
        assert!(matches!(agent, SshAuthMethod::Agent));
        assert_eq!(serde_json::to_string(&agent).unwrap(), r#"{"type":"Agent"}"#);

        let pwd: SshAuthMethod =
            serde_json::from_str(r#"{"type":"Password","value":"secret"}"#).unwrap();
        assert!(matches!(pwd, SshAuthMethod::Password(ref s) if s == "secret"));

        let kf: SshAuthMethod = serde_json::from_str(
            r#"{"type":"KeyFile","value":{"path":"/tmp/id_ed25519","passphrase":null}}"#,
        )
        .unwrap();
        assert!(matches!(kf, SshAuthMethod::KeyFile { ref path, passphrase: None } if path == "/tmp/id_ed25519"));
    }
}
