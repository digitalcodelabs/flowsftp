# 🚀 TermSFTP

<div align="center">

**A modern, blazing-fast, and secure dual-pane SFTP / FTP / FTPS client with an integrated hardware-accelerated SSH terminal.**

Built with **Tauri v2**, **Rust**, **Nuxt 4**, **Vue 3**, **Tailwind CSS**, and **xterm.js**.

[![Built with Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4.x-00DC82?style=flat-square&logo=nuxt&logoColor=white)](https://nuxt.com/)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat-square&logo=vue.js&logoColor=white)](https://vuejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## 🌟 Overview

**TermSFTP** reimagines classic file transfer tools like FileZilla and WinSCP for modern developers. It combines a high-performance **dual-pane local & remote file manager** with a full-featured **tabbed SSH terminal** powered by WebGL. 

With native OS performance, encrypted credential vaulting, live file search filtering, built-in code editing, macOS-style Quick Look preview, FileZilla-exact 3-tab transfer queueing, non-blocking background deletions, and rich Catppuccin theming, TermSFTP delivers a unified workflow for server administration, remote development, and file management.

---

## ✨ Key Features

### 📁 Dual-Pane File Manager (Local & Remote)
- **Side-by-Side Browsing**: Concurrent views for local file system and remote server listings.
- **Ergonomic Full-Window Resizable Panes (Left, Right & Bottom)**:
  - **Horizontal Splitter**: Smoothly drag the divider between Local and Remote browser panes to adjust screen estate. Double-click the splitter to instantly snap back to a 50/50 balance.
  - **Vertical Splitter**: Resizable bottom transfer queue drawer with custom height memory, 20px extended hit zone, and centered grip indicator. Double-click the handle to reset to default height.
  - **Expand/Collapse Support**: Collapse the transfer queue to maximize workspace; dragging the splitter bar upward automatically re-expands the drawer.
  - **Global Drag Overlays**: Transparent full-screen shields prevent iframes, text selections, or table events from interrupting dragging gestures.
  - **Auto-Persistent Layout**: Custom pane split ratios, drawer heights, and column widths are automatically saved and restored on next launch.
- **Instant In-Pane Live Filter (`Ctrl+F` / `Cmd+F`)**:
  - Live, real-time substring filtering across directories containing thousands of items.
  - In-line highlight pills identifying matched query substrings.
  - Match count badges (`X of Y items` / `X found`).
  - Smooth keyboard ergonomics: <kbd>↓ Down</kbd> / <kbd>Enter</kbd> to jump straight into matched items, <kbd>Esc</kbd> to clear query or dismiss filter.
  - Auto-resets cleanly upon directory navigation or session switching.
- **Directory Comparison Mode (`Ctrl+Shift+C` / `Cmd+Shift+C`)**:
  - Visual side-by-side diff comparing the current local directory against the remote directory.
  - Color-coded rows and badges: `+ Local Only` (green), `+ Remote Only` (blue), `▲ Newer` / `▼ Older` (amber), and `≠ Size Diff` (rose).
  - Flexible comparison criteria: *File Size & Modification Time* or *File Size Only*.
  - "Hide identical files" filter option to isolate only files that need synchronization.
  - Smart one-click Quick-Sync actions: **"Sync to Remote"** (batch uploads local-only/newer files) and **"Sync to Local"** (batch downloads remote-only/newer files).
- **Synchronized Navigation (Lockstep Browsing)**:
  - Toggle lockstep navigation with one click in the toolbar.
  - Entering a folder locally automatically navigates to the matching folder remotely (and vice versa).
  - Parent directory (`..`) navigation is synchronized between both panes.
- **Server-Side & Local Archive Operations (One-Click Extract & Compress)**:
  - **Instant Remote Extraction**: Right-click `.zip`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tar.xz`, or `.7z` archives on the server to extract in place or into a subfolder over the SSH channel — eliminating the need to download large archives or open an external shell.
  - **Server-Side Compression**: Select any files or directories on the remote server and compress directly into `.tar.gz` or `.zip` archives with real-time feedback.
  - **Cross-Platform Local Support**: Native archive extraction and compression on Windows, macOS, and Linux without external dependencies.
- **Background Async Deletion with Live Cancel**:
  - Deleting massive folders (such as `node_modules` or `vendor`) runs asynchronously in the background without freezing the UI or blocking file navigation.
  - Real-time floating status card shows item title, completed/total count, and live spinner.
  - **One-Click Cancel**: Instantly halts recursive deletion loops safely on both local and remote filesystems.
- **Parent Directory Entry (`📁 ..`)**: Classic FileZilla-style parent directory row for swift mouse and keyboard navigation.
- **Path Address Bars**: Direct keyboard path input with auto-completion and breadcrumbs.
- **Quick Bookmarks**: Pin frequently visited remote directories (`/var/www`, `/etc`, `~`) and local folders.
- **Multi-Selection & Batch Operations**:
  - Multi-file selection with <kbd>Shift+Click</kbd>, <kbd>Ctrl/Cmd+Click</kbd>, and <kbd>Ctrl+A</kbd>.
  - Batch upload, download, and recursive deletion with confirmation modals.
- **Drag & Drop**:
  - Drag files directly between Local and Remote panes.
  - Drag into subfolders or onto parent `..` directory to drop into parent folders.
  - Native OS drag-and-drop from Windows Explorer / macOS Finder / Linux file managers.
- **WSL (Windows Subsystem for Linux) Integration**:
  - Automatic detection of installed WSL distributions (e.g. `Ubuntu-24.04`).
  - One-click jumping to `//wsl.localhost/<distro>` directly from the local toolbar.
- **Git Status Indicators**:
  - Visual badges (`M` Modified, `U` Untracked, `S` Staged, `D` Deleted) for local and remote repositories.
  - Active branch indicators in path address bars.

---

### 📥 FileZilla-Exact 3-Tab Transfer Queue & Bottom Drawer
- **Dedicated 3-Tab Structure**:
  - **Queued files**: Shows pending and currently transferring items.
  - **Failed transfers**: Logs interrupted, failed, or cancelled transfers with error reason and timestamp.
  - **Successful transfers**: History of completed files with transfer duration and transferred bytes.
  - Live tab counter badges showing current item counts (`Queued files (4)`, `Failed transfers (1)`).
- **Server Grouping Tree**:
  - Transfers are organized hierarchically under server group headers (`sftp://user@host`).
- **FileZilla-Style Live Progress Bars**:
  - Crisp green progress bar per active transfer row showing percentage completion.
  - Live elapsed time counter (`00:01:24`) and calculated ETA time remaining (`00:00:32`).
  - Exact transferred bytes and real-time transfer speed (`3.4 MiB/s`).
  - Direction indicator arrows (`-->` Upload, `<--` Download).
- **Resizable & Persistent Queue Columns**:
  - Draggable column header divider handles for all columns: `Server/Local file`, `Direction`, `Remote file`, `Size`, `Priority`, `Status`, `Time`, and `Reason`.
  - Column widths automatically persist across restarts.
  - Double-click any column divider to reset back to default width.
- **Action After Queue Completion**:
  - Configurable action triggered automatically when the queue finishes:
    - **Do nothing** (default)
    - **Play notification sound**: Synthesizes a crisp, pleasant two-tone completion chime via Web Audio API.
    - **Disconnect from server**: Automatically closes active SFTP and SSH connections upon completion.
    - **Close Termsftp**: Closes the application cleanly after a 2-second grace period with audio feedback.
  - Status bar indicator badge highlights active completion actions (`🔔 Sound on complete`, `🔌 Disconnect on complete`, `🚪 Close on complete`).
- **Queue Controls & Right-Click Context Actions**:
  - **Process Queue / Pause Queue**: Toggle queue processing on the fly.
  - **Set Priority**: Adjust task priority per file or batch (`Lowest`, `Low`, `Normal`, `High`, `Highest`).
  - **Reset and requeue all files**: Immediately requeues successful or failed transfers and resumes processing.
  - **Stop and remove selected**: Instantly aborts active transfers and removes items from queue.
  - **Remove all**: Clears finished or failed history.
  - **Export Transfers**: Save queue lists to plain text files.

---

### ⚡ Integrated SSH Terminal
- **Hardware-Accelerated WebGL Engine**: Ultra-smooth rendering using `@xterm/xterm` and `@xterm/addon-webgl`.
- **Multi-Session Tabs**: Keep multiple SSH connections open simultaneously with active status indicators.
- **"Open in Terminal" Integration**: One-click jump from any remote SFTP folder straight into the SSH terminal (`cd /path/to/folder`).
- **Fit Addon**: Automatically synchronizes terminal rows and columns with window resize events.

---

### 🛡️ Protocols & Security
- **Protocols Supported**:
  - **SFTP** (over SSH) powered by Rust's asynchronous `russh` and `russh-sftp`.
  - **FTP / FTPS** (TLS/SSL encryption) powered by `suppaftp`.
  - **SSH Shell** for interactive terminal sessions.
- **Master Password & Encrypted Vault**: Protect saved host profiles and credentials with AES encryption, including master password reset workflows.
- **OS Native Keyring Support**: Integration with Windows Credential Manager, macOS Keychain, and Linux Secret Service via the `keyring` crate.
- **Authentication Methods**:
  - Password authentication.
  - **SSH Private Keys**: OpenSSH, RSA, and Ed25519 formats with passphrase decryption.
  - **PuTTY Private Keys (.ppk)**: Native support for PuTTY `.ppk` v2 and v3 private keys without external conversion.
  - Custom SSH ports and connection timeouts.

---

### 📝 Integrated Tools
- **Built-in Code Editor**:
  - Edit remote and local files directly in-app without downloading external copies.
  - Syntax highlighting via CodeMirror / Monaco for 100+ programming languages.
  - Vim keybinding mode toggle.
  - Auto-upload and cache invalidation on save (<kbd>Ctrl+S</kbd>).
- **Quick Look Instant Preview (<kbd>Spacebar</kbd>)**:
  - macOS-inspired file preview for quick file inspection.
  - Full preview support for Markdown, JSON, source code, and images.
  - Navigate between files seamlessly using <kbd>←</kbd> and <kbd>→</kbd> arrow keys.
- **Permissions Modal (chmod)**:
  - Interactive Unix permission calculator with checkboxes (Read, Write, Execute).
  - Octal representation editor (e.g. `0755`, `0644`).
- **High-Throughput Queue Worker**:
  - **Multi-Worker Concurrency**: Configurable 1 to 10 parallel transfer workers (`Workers: 1, 2, 3, 5, 8, 10`).
  - **Directory Flattening**: Pre-scans nested folders into flat task queues so parallel threads stay 100% utilized instead of choking on a single folder thread.
  - **Batch Processing**: Transfers entire file batches without thrashing per-file directory listings, preventing UI freezes and connection timeouts. Refreshes once upon batch completion.
- **Connection Health & Auto-Reconnect**:
  - Heartbeat background polling every 25 seconds.
  - Sleep-wake detection and automatic reconnect countdown on dropped connections.

---

### 🎨 Customization & Theming
- **Curated Theme Palettes**:
  - **Catppuccin**: Mocha, Macchiato, Frappé, Latte.
  - **Developer Classics**: Tokyo Night, Dracula, Nord, One Dark, GitHub Dark & Light.
- **File & Folder Icons**: Rich file type icons powered by Catppuccin file icons and Lucide icons.
- **Row Density Options**: Compact, Normal, and Relaxed row heights.
- **Custom Fonts**: Configurable monospace fonts and font sizes for file listings and terminal.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> / <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | File Browser | Toggle Directory Comparison Mode |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> / <kbd>⌘</kbd> + <kbd>F</kbd> | File Browser | Toggle In-Pane Live Filter |
| <kbd>Space</kbd> | File Browser | Quick Look / Instant Preview |
| <kbd>Enter</kbd> | File Browser | Open folder / edit file (or select first filter match) |
| <kbd>↓</kbd> / <kbd>↑</kbd> | File Browser | Navigate file rows |
| <kbd>Backspace</kbd> / <kbd>Alt</kbd> + <kbd>↑</kbd> | File Browser | Navigate to parent directory (`..`) |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> / <kbd>⌘</kbd> + <kbd>A</kbd> | File Browser | Select all files in active pane |
| <kbd>Delete</kbd> | File Browser | Delete selected file(s) (with async background cancel) |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>⌘</kbd> + <kbd>S</kbd> | Code Editor | Save and upload file |
| <kbd>Esc</kbd> | Global | Close modals, clear filter, or dismiss preview |
| <kbd>Ctrl</kbd> + <kbd>T</kbd> / <kbd>⌘</kbd> + <kbd>T</kbd> | Global | Open Connection Manager |

---

## 🛠️ Tech Stack & Architecture

- **Desktop Framework**: [Tauri v2](https://tauri.app/) (Rust backend + native OS webview)
- **Frontend Framework**: [Nuxt 4](https://nuxt.com/) / [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`)
- **State Management**: [Pinia](https://pinia.vuejs.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + CSS variables design system
- **Terminal Emulator**: [xterm.js](https://xtermjs.org/) with `@xterm/addon-webgl` and `@xterm/addon-fit`
- **Code Editor**: [CodeMirror 6](https://codemirror.net/) with `@replit/codemirror-vim`
- **Icons**: `@iconify-json/catppuccin` & `lucide-vue-next`
- **Rust Backend Crates**:
  - `russh` & `russh-sftp` — Async SSH & SFTP client
  - `suppaftp` — FTP & FTPS client with TLS
  - `keyring` — Native system keychain integration
  - `tokio` — Asynchronous multi-threaded runtime

---

## 📦 Prerequisites

Ensure you have the following installed on your development machine:

1. **Node.js**: `v18.0.0` or higher (Node `v20+` or `v22+` recommended).
2. **Package Manager**: `npm`, `pnpm`, or `bun`.
3. **Rust Toolchain**: `v1.90+` / Rust 2024 edition.
   - Install via [rustup.rs](https://rustup.rs/):
     ```bash
     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
     ```

### OS-Specific Requirements (Tauri v2)

#### Windows
- **C++ Build Tools**: Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the *"Desktop development with C++"* workload.
- **WebView2**: Built into Windows 10 & 11.

#### Linux (Debian / Ubuntu)
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

#### macOS
- Install Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```

---

## 🚀 Getting Started

### 1. Clone Repository
```bash
git clone https://github.com/your-username/termsftp.git
cd termsftp
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run in Development Mode
Launch both the Nuxt frontend and Tauri native desktop window with Hot Module Replacement (HMR):
```bash
npm run tauri:dev
```

---

## 🏗️ Building for Production

### Build Desktop Application Installer
To compile the optimized Rust release binary and bundle platform installers (`.exe`/`.msi` on Windows, `.dmg`/`.app` on macOS, `.deb`/`.AppImage` on Linux):

```bash
npm run tauri:build
```

The output artifacts will be generated in:
```
src-tauri/target/release/bundle/
```

### Frontend-Only Build (Web Validation)
To validate and type-check the Vue/Nuxt application:
```bash
npm run build
```

---

## 📂 Project Structure

```
termsftp/
├── app/                         # Frontend application (Nuxt 4 / Vue 3)
│   ├── app.vue                  # Main application shell & tab router
│   ├── components/              # Vue components
│   │   ├── SftpBrowser.vue      # Dual-pane SFTP & local file manager
│   │   ├── SshTerminal.vue      # xterm.js WebGL SSH terminal
│   │   ├── FileEditorModal.vue  # CodeMirror code editor with Vim mode
│   │   ├── QuickLookModal.vue   # macOS-style instant file preview
│   │   ├── ConnectionManagerModal.vue # Connection profiles & vault
│   │   ├── PermissionsModal.vue # Unix chmod visual calculator
│   │   └── SettingsModal.vue    # App settings & preferences
│   ├── stores/                  # Pinia state stores
│   │   ├── sftp.ts              # SFTP/Local files, queue, bookmarks
│   │   ├── ssh.ts               # SSH session management
│   │   ├── vault.ts             # Encrypted server profiles
│   │   ├── settings.ts          # Density, fonts, keymaps
│   │   └── theme.ts             # Theme palettes
│   └── utils/                   # Keymap & utility helpers
│
├── src-tauri/                   # Rust backend (Tauri v2)
│   ├── Cargo.toml               # Rust dependencies
│   ├── tauri.conf.json          # Tauri application configuration
│   └── src/
│       ├── main.rs              # Tauri initialization
│       ├── lib.rs               # Library entry & command registration
│       └── commands/            # Tauri IPC command modules
│           ├── sftp.rs          # SFTP engine & local filesystem commands
│           ├── ssh.rs           # SSH terminal PTY & streaming
│           ├── ftp.rs           # FTP / FTPS protocol implementation
│           ├── keychain.rs      # OS native credential storage
│           └── dialog.rs        # Native file & folder dialogs
│
├── package.json                 # Node dependencies and scripts
├── nuxt.config.ts               # Nuxt 4 configuration
└── tailwind.config.js           # Tailwind CSS configuration
```

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for details.
