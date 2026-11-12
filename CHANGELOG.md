# Changelog

All notable changes to **FlowSFTP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — v1.0.1 (2026-11-12)

### Release Highlights
- **FileZilla-Style FTP / FTPS Transfer Modes (`Auto` / `Binary` / `ASCII`)**: Added automatic and manual FTP data representation selection so ionCube-encoded `.php` files, SourceGuardian/Phar scripts, and binary assets are always transferred byte-for-byte in `Binary` (`TYPE I`) mode without corrupting byte offsets.
- **Hardened FTP, FTPS & SFTP Stream Finalization**: Enforced explicit `TYPE` negotiation before every FTP data transfer, explicit TLS/TCP stream flushing before closing FTPS uploads, and checked `flush` + `shutdown` acknowledgments on pipelined SFTP uploads.

### Added
- **FTP / FTPS Transfer Data Type (`Auto` / `Binary` / `ASCII`)**:
  - **`Auto` Mode (Default)**: Inspects the first 16 KB of local files before `STOR` to detect NUL/binary bytes, invalid UTF-8 sequences, ionCube hex headers (`<?php //004fb`), and encoded PHP signatures (`ionCube`, `SourceGuardian` / `sg_load`, `Zend Guard`, `Phar`, `__halt_compiler`, `phpBolt`), automatically switching to `Binary` (`TYPE I`) even for 7-bit ASCII-armored ionCube `.php` files. Keeps `.php` downloads in `Binary` mode so remote encoded scripts are never altered.
  - **Settings & Status Bar Controls**: Added the **FTP / FTPS Transfer Data Type** selector in **Settings -> Transfers** and a quick-cycle `Type: Auto | Binary | ASCII` status pill in the bottom transfer queue bar whenever an FTP/FTPS session is active.
- **Built-In Text Editor Binary / Encoded File Guard**: Displays a warning banner when opening files containing non-UTF-8 / binary bytes (such as binary-encoded ionCube files) so they aren't accidentally overwritten as lossy UTF-8 text.

### Fixed
- **FTP Corruption After Directory Listings (`LIST`)**: Fixed FTP servers (`Pure-FTPd`, `ProFTPD`, `cPanel`, `vsFTPd`, `IIS`) leaving pooled or shared connections in `ASCII` (`TYPE A`) mode after `LIST` operations by explicitly setting the transfer type before every `STOR` / `RETR` and restoring `Binary` (`TYPE I`) afterward so `SIZE` checks, Quick Look, checksums, remote copies, and external-editor saves remain byte-exact.
- **FTPS & SFTP Upload Flush Integrity**: Added explicit `writer.flush()` before `finalize_put_stream` on FTP/FTPS uploads so `RustlsStream` buffers never drop trailing bytes, and verified both `flush().await` and `shutdown().await` (`SSH_FXP_CLOSE`) on SFTP uploads before applying file metadata.
- **CI & Release Pipeline Modernization**: Upgraded GitHub Actions workflows to Node 24 (`actions/checkout@v7`, `actions/setup-node@v7`, `tauri-apps/tauri-action@v1`) and resolved Rust `1.99` Clippy lints across Linux, macOS, and Windows runners.

---

## [1.0.0] — v1.0.0 (2026-11-11)

### Release Highlights
- **In-App Auto-Updater (`flowsftp.com`)**: Automatic startup update checks, top-bar update notification pill, and one-click in-app download & installation with live progress in **Settings -> About**.
- **System SSH Agent & `~/.ssh/config` Import**: Authenticate directly with keys and OpenSSH certificates from `ssh-agent`, 1Password, Bitwarden, GPG Agent, or Pageant, and import concrete hosts from `~/.ssh/config` in one click.
- **Encrypted Profile & Vault Backup**: Export and restore saved connection profiles, folders, Master Password vault secrets, and bookmarks in a single `AES-256-GCM` encrypted `.flowsftp.json` bundle across Windows, Linux, and macOS.
- **Virtualized File Panes (`10,000+` Files at 60–120fps) & Type-Ahead Jump**: Local and remote file browsers render massive directories smoothly and let you jump directly to matching folders or files by typing letters.
- **Interface & Dialogs Text Scaling**: Dedicated **UI & Modal Text Scale** slider (`11px`–`18px`) in **Settings -> Fonts & Sizing** scales Settings, Connection Manager, menus, and helper descriptions cleanly without breaking fixed-height chrome or virtualized rows.
- **Production FTPS & Updater Security Hardening**: FTPS connections now verify certificates against the OS root trust store (`TLS 1.2` + `TLS 1.3`) with an opt-in per-profile self-signed override, paired with a strict WebView CSP and hardened updater URL/host validation.

### Added
- **In-App Auto-Updater (`flowsftp.com`)**: Powered by `https://flowsftp.com/update/{target}/{arch}/{current_version}`, supporting `.exe`, `.msi`, `.AppImage` (atomic sibling swap), `.deb`, `.rpm`, and `.dmg` packages with concurrency guards and automatic stale temp-bundle cleanup.
- **File Pane Type-Ahead Jump**: Pressing letters/characters in the Local or Remote file pane jumps directly to the matching folder or file, cycling through items when pressing the same letter repeatedly or matching multi-character prefixes when typed quickly.
- **Interface & Dialogs Text Size Slider**: Added a UI & Modal Text Scale slider (`11px`–`18px`, default `13px`) in **Settings -> Fonts & Sizing** scoped under `.ui-scaled` with tuned `line-height` across all dialogs and context menus.
- **FTPS TLS Certificate Verification & Per-Profile Override**: FTPS connections verify server certificates against the operating system trust store (`rustls-platform-verifier`) by default, with an opt-in **Allow self-signed / untrusted TLS certificates** toggle per profile in Connection Manager.
- **System SSH Agent Authentication (`Agent`)**: Full SSH agent support across Linux/macOS (`SSH_AUTH_SOCK` Unix sockets) and Windows (OpenSSH Named Pipe, 1Password/Bitwarden SSH Agent, and Pageant), supporting Ed25519, ECDSA, RSA (`rsa-sha2-512` / `rsa-sha2-256` negotiation), and OpenSSH Certificates.
- **One-Click `~/.ssh/config` Importer**: Parses `~/.ssh/config` (including bounded `Include` directives, `~/` key expansion, and `Host *` inherited defaults while skipping wildcard-only blocks) into saved Connection Manager profiles.
- **Encrypted Backup Export & Import**: Added **Encrypted Profile & Vault Backup** in **Settings -> Security** (`PBKDF2-HMAC-SHA256` + `AES-256-GCM`) supporting both **Merge** and **Replace** restore modes.
- **Virtual Row Scrolling for Large Directories**: Added `useVirtualFileRows` to both Local and Remote SFTP panes so directories with tens of thousands of entries render smoothly without DOM lag.
- **Multi-Platform GitHub Actions CI & Release Workflows**: Automated TypeScript typechecking, Vitest unit tests, SPA builds, Clippy lints, Cargo tests, and cross-platform Tauri bundle builds across Linux, Windows, and macOS.

### Fixed
- **Multi-Session & Dual-Remote Polish**:
  - Fixed background SSH session timeouts accidentally disconnecting the currently active session tab.
  - Routed left-pane context-menu, keyboard, drag-and-drop, and directory comparison actions cleanly when operating in Server-to-Server (Dual-Remote) mode.
  - Resolved per-session remote paths during background transfer conflict checks, deletes, archive extraction/compression, and post-transfer directory refreshes when multiple session tabs are open.
  - Isolated file-pane keyboard navigation while Quick Look (`Space`) is open and synced active pane row selection when stepping Quick Look items.
  - Added sticky header scroll padding (`scroll-padding-top`) to Local and Remote file tables so upward keyboard navigation never hides selected rows behind column headers.
- **Security & Resource Cleanup**:
  - Enabled a strict WebView Content Security Policy (`CSP`) in `tauri.conf.json` restricting script execution, object embeds, and IPC/blob origins.
  - Hardened the in-app auto-updater with strict `reqwest::Url` parsing and an HTTPS host allowlist (`flowsftp.com` and GitHub Releases).
  - Added global application exit cleanup (`RunEvent::Exit`) to purge any remaining staged external-editor temporary files and zeroize unlocked vault state on shutdown.

---

## [0.9.1] — v0.9.1-beta.2 (2026-11-09)

### Release Highlights
- **Transfer While Counting (Streaming Crawls & FTP Connection Pool)**: Uploading or downloading deep folders with thousands of files now begins transferring almost immediately instead of waiting for the entire directory tree to be counted first.
- **Calm, Flat UI Redesign**: Every button, tab, input, and modal across the header, **Settings**, **Connection Manager**, and **Vault** dialogs now uses a flat, low-brightness, soft-bordered aesthetic that is easy on the eyes during long sessions.
- **First-Class Tiling Window Manager Support (Hyprland / Omarchy / Wayland)**: Reduced minimum window bounds (`420x320`) and added responsive vertical dual-pane stacking so FlowSFTP scales cleanly in narrow side-by-side or quarter-screen tiles on Linux tiling compositors.
- **Terminal Zoom & Clipboard Shortcuts**: Zoom terminal text on the fly with `Ctrl + +` / `Ctrl + -` / `Ctrl + 0`, and copy/paste terminal selections effortlessly with `Ctrl + Shift + C` and `Ctrl + Shift + V`.

### Added
- **Streaming Directory Crawls (`sftp` & `ftp`)**: Recursive local and remote folder crawls now emit discovered batches incrementally (every 50 items or 150ms) so the transfer queue begins uploading/downloading right away while counting continues in the background.
- **Concurrent FTP/FTPS Worker Pool**: Dedicated pooled FTP transfer connections allow multiple files to transfer while directory crawling and interactive browsing remain responsive.
- **Terminal Font Zoom Shortcuts**: Support `Ctrl + =` / `Ctrl + +` (zoom in), `Ctrl + -` (zoom out), and `Ctrl + 0` (reset to `13px`) directly inside the integrated SSH terminal.
- **Terminal Keyboard Copy & Paste**: Support `Ctrl + Shift + C` to copy active mouse selections to the clipboard and `Ctrl + Shift + V` to paste into the active SSH session.
- **Empty-State Quick Settings Button**: Added a `Settings` button alongside `Connection Manager` on the initial no-session welcome screen for immediate access to themes, fonts, and keymaps on first launch.
- **File Browser Font Size Slider**: Replaced the fixed 4-preset font size buttons in **Settings -> Fonts & Sizing** with a smooth `10px`–`20px` range slider and proportional file/folder icon scaling.
- **Quick Settings Shortcut (`Ctrl + Shift + P`)**: Bound `Ctrl + Shift + P` to open Settings from anywhere in the app while suppressing the default WebView print dialog.
- **Master Password Vault Onboarding**: Saving connection credentials when the vault is uninitialized now guides users directly through Master Password setup, with live vault status controls (`Set Up Vault`, `Vault Locked`, `Vault Unlocked`) in the Connection Manager header.

### Changed
- **Flat, Low-Brightness Button & Border System**: Removed 3D glossy `inset` bevels, drop shadows, and bright neon hover glows across `.btn-accent`, `.btn-accent-secondary`, `.btn-theme-card`, `.btn-danger`, toggle switches, and modal cards in favor of subtle surface tints, soft `color-mix` borders, and a gentle hover brightness lift.
- **Minimal Icon-Only Titlebar Controls**: Streamlined header `Disconnect`, `Settings`, and `Connection Manager` buttons to compact square icon buttons (`28x28`) with descriptive tooltips and softer active session tab borders.
- **Responsive Dual-Pane Tiling Layout**: Reduced `minWidth` / `minHeight` window bounds to `420x320` in Tauri config, locked toolbar icon buttons against flex distortion, and automatically switch the dual-pane SFTP browser into a stacked top/bottom split with a horizontal resize handle when window width drops below `640px`.
- **Smart SSH Key Selection**: Selecting a `.pub` public key file in the Connection Manager automatically resolves to its sibling private key when available, and the file picker now surfaces extensionless OpenSSH keys (such as `id_ed25519` and `id_rsa`).

### Fixed
- **Windows Console Flash Prevention**: Applied `CREATE_NO_WINDOW` (`0x08000000`) to background `git`, `wsl`, `reg`, and `tar` subprocesses on Windows so terminal windows never flicker during Git status checks, WSL detection, or archive operations.
- **macOS Bundle Configuration**: Resolved Tauri bundle naming collision on macOS builds.
- **Security & Stability Hardening**:
  - Guarded local archive extraction against path traversal (`Zip-Slip`) outside destination directories.
  - Switched Master Password vault verifier checks to constant-time comparison and stopped persisting plaintext session secrets in `sessionStorage`.
  - Preserved original remote POSIX file permissions when auto-uploading files via External Editor Live Sync.
  - Bounded remote SSH grep/find stdout memory buffers and hardened shell argument escaping.
  - Fixed session teardown and cancelled connection races so background watchers, staged temp files, and SSH handles clean up deterministically.

---

## [0.9.0] — v0.9.0-beta.1 (2026-11-05)

### Highlights
- **Dual-Pane SFTP / FTP / FTPS File Manager**: Support for Local ↔ Remote and direct Server-to-Server (Remote ↔ Remote) browsing, drag-and-drop transfers, synchronized lockstep navigation, and visual directory comparison (`Ctrl + Shift + C`).
- **Hardware-Accelerated Multi-Tab SSH Terminal**: Integrated `xterm.js` + WebGL terminal with one-click *"Open in Terminal"* folder navigation and custom JSON theme support (including Catppuccin Mocha & Latte).
- **SSH Host-Key Verification (TOFU)**: Interactive fingerprint verification modal for unknown and changed SSH host keys backed by `known_hosts`.
- **Developer Workflow Suite**: Built-in **CodeMirror 6** editor with optional **Vim mode**, **Quick Look** media/code/PDF/Markdown preview (`Space`), **External Editor Live Sync** (VS Code, Cursor, Sublime Text, Notepad++), **Live Directory Watcher** folder pairing, and kernel-speed **Remote SSH Search & Grep** (`Ctrl + Shift + F`).
- **FileZilla-Style 3-Tab Transfer Queue**: Resizable bottom transfer drawer with `Queued`, `Failed`, and `Successful` tabs, smart conflict resolution (**Overwrite**, **Resume**, **Auto-Rename**, **Skip**), configurable glob ignore rules, and queue completion actions.
- **Modular Store Architecture & Test Suite**: Extracted transfer pipeline, queue pump, conflict resolution, directory browser, and file operations into dedicated composables covered by 149 automated Vitest unit tests.
