use russh::client::Handler;
use russh::keys::PublicKeyOrCertificate;
use std::future::Future;

#[derive(Clone, Default)]
pub struct SshClientHandler;

impl Handler for SshClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        async {
            // Accept the server host key (auto-accept for development/SSH clients)
            Ok(true)
        }
    }
}
