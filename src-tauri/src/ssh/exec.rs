//! One-shot remote command execution that reports the command's real exit status.
//!
//! Scraping a command's output for words like "cannot" or "Permission denied" is unreliable
//! (localised servers, file names that contain those words, ...). The SSH protocol reports
//! the exit status explicitly, so use that to decide whether a command succeeded.

use std::time::Duration;

use russh::client::Handle;
use russh::ChannelMsg;

use crate::ssh::client::SshClientHandler;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecOutcome {
    /// The command ran to completion and exited with this status.
    Exited(u32),
    /// The channel closed without ever reporting an exit status.
    NoStatus,
    /// The command was still running when the timeout expired.
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecResult {
    pub outcome: ExecOutcome,
    /// stdout and stderr, interleaved in arrival order.
    pub output: String,
}

impl ExecResult {
    /// True only for a clean exit (status 0). A missing status is NOT treated as success.
    pub fn succeeded(&self) -> bool {
        self.outcome == ExecOutcome::Exited(0)
    }
}

/// Runs `command` on a fresh exec channel and waits for it to finish.
///
/// Returns `Err` only when the channel could not be opened or the command could not be sent.
pub async fn run_command(
    handle: &Handle<SshClientHandler>,
    command: String,
    timeout: Duration,
) -> Result<ExecResult, String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open exec channel: {}", e))?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to send command: {}", e))?;

    let mut exit_status: Option<u32> = None;
    let mut output: Vec<u8> = Vec::new();

    // The exit status may arrive before or after EOF, so keep reading until the channel closes.
    let finished = tokio::time::timeout(timeout, async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => output.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => output.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
    })
    .await
    .is_ok();

    if !finished {
        let _ = channel.close().await;
    }

    let outcome = match (exit_status, finished) {
        (Some(status), _) => ExecOutcome::Exited(status),
        (None, true) => ExecOutcome::NoStatus,
        (None, false) => ExecOutcome::TimedOut,
    };

    Ok(ExecResult {
        outcome,
        output: String::from_utf8_lossy(&output).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(outcome: ExecOutcome) -> ExecResult {
        ExecResult { outcome, output: String::new() }
    }

    #[test]
    fn only_exit_status_zero_counts_as_success() {
        assert!(result(ExecOutcome::Exited(0)).succeeded());
        assert!(!result(ExecOutcome::Exited(1)).succeeded());
        assert!(!result(ExecOutcome::Exited(127)).succeeded());
    }

    #[test]
    fn missing_status_and_timeouts_are_not_success() {
        // A cp whose outcome we never learned must not be reported as a completed copy.
        assert!(!result(ExecOutcome::NoStatus).succeeded());
        assert!(!result(ExecOutcome::TimedOut).succeeded());
    }

    #[test]
    fn output_text_never_influences_success() {
        // The old implementation looked for "cannot" / "Permission denied" in the output.
        let noisy_but_ok = ExecResult {
            outcome: ExecOutcome::Exited(0),
            output: "cp: warning: cannot preserve something harmless".to_string(),
        };
        let quiet_but_failed = ExecResult { outcome: ExecOutcome::Exited(1), output: String::new() };
        assert!(noisy_but_ok.succeeded());
        assert!(!quiet_but_failed.succeeded());
    }
}
