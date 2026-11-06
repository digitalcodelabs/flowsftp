# 🚀 FlowSFTP

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

**FlowSFTP** reimagines classic file transfer tools like FileZilla and WinSCP for modern developers. It combines a high-performance **dual-pane local & remote file manager** (supporting Local ↔ Remote and Server-to-Server Remote ↔ Remote workflows) with a full-featured **tabbed SSH terminal** powered by WebGL. 

With native OS performance, SSH host-key verification (TOFU), an encrypted master-password credential vault, a built-in **CodeMirror 6 code editor with full Vim mode**, macOS-style **Quick Look** preview (Markdown, JSON, PDF, Audio, Video, Images, Code), external editor live sync, live folder pairing with auto-upload, recursive remote SSH grep, smart conflict resolution with transfer resume, FileZilla-exact 3-tab transfer queueing, non-blocking background deletions, and rich Catppuccin theming, FlowSFTP delivers a unified workflow for server administration, remote development, and file management.

---

## ✨ Key Features

### 📁 Dual-Pane File Manager (Local ↔ Remote & Remote ↔ Remote)
- **Flexible Dual-Pane Sources (Local or Remote-to-Remote)**:
  - Browse your local filesystem alongside a remote SFTP/FTP/FTPS server, or switch the left pane to any active remote session for **direct Server-to-Server (Remote ↔ Remote) browsing and transfers**.
  - Same-server remote copies automatically use fast server-side copy (`cp`) over SSH, while cross-server transfers stream directly between sessions.
- **Ergonomic Full-Window Resizable Panes (Left, Right & Bottom)**:
  - **Horizontal Splitter**: Smoothly drag the divider between Left and Right browser panes to adjust screen estate. Double-click the splitter to instantly snap back to a 50/50 balance.
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
  - Visual side-by-side diff comparing the left pane directory against the right pane directory.
  - Color-coded rows and badges: `+ Local Only` (green), `+ Remote Only` (blue), `▲ Newer` / `▼ Older` (amber), and `≠ Size Diff` (rose).
  - Flexible comparison criteria: *File Size & Modification Time* or *File Size Only*.
  - "Hide identical files" filter option to isolate only files that need synchronization.
  - Smart one-click Quick-Sync actions: **"Sync to Remote"** (batch uploads local-only/newer files) and **"Sync to Local"** (batch downloads remote-only/newer files).
- **Synchronized Navigation (Lockstep Browsing)**:
  - Toggle lockstep navigation with one click in the toolbar.
  - Entering a folder in one pane automatically navigates to the matching folder in the other pane (and vice versa).
  - Parent directory (`..`) navigation is synchronized between both panes.
- **Rich File Operations, Clipboard & Symlinks**:
  - **Cross-Pane Cut, Copy & Paste (`Ctrl+X`, `Ctrl+C`, `Ctrl+V`)**: Seamlessly copy or move files within the same pane, between Local and Remote, or across two different Remote servers.
  - **One-Click Duplicate (`Ctrl+D`)**: Instantly duplicate files or directories locally or remotely (`- Copy`).
  - **Symbolic Link Creation**: Create symbolic links (`ln -s`) on local and remote filesystems via the New Symlink modal (`SftpNewSymlinkModal`), with inline `-> target` indicators.
  - **SHA-256 & MD5 Checksum Calculator (`SftpChecksumModal`)**: Compute and verify `SHA-256` and `MD5` file hashes on both local and remote servers with one-click copy and hash comparison.
  - **On-Demand Directory Size Calculation**: Calculate recursive folder sizes directly from the context menu.
- **Server-Side & Local Archive Operations (One-Click Extract & Compress)**:
  - **Instant Remote Extraction**: Right-click `.zip`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tar.xz`, or `.7z` archives on the server to extract in place or into a subfolder over the SSH channel — eliminating the need to download large archives or open an external shell.
  - **Server-Side Compression**: Select any files or directories on the remote server and compress directly into `.tar.gz` or `.zip` archives with real-time feedback.
  - **Cross-Platform Local Support**: Native archive extraction and compression on Windows, macOS, and Linux without external dependencies.
- **Smart Conflict Resolution & Transfer Resume (`SftpConflictModal`)**:
  - Interactive conflict prompt when target files already exist, showing side-by-side file sizes and timestamps (`Newer`, `Older`, `Larger`, `Smaller` badges).
  - Choose **Overwrite**, **Resume** (resumes partial SFTP/FTP downloads, uploads, and remote-to-remote transfers), **Auto-Rename**, or **Skip**, with *"Apply to current queue"* and session-wide default policies.
- **Configurable Transfer Ignore Rules**:
  - Define global glob/wildcard ignore patterns (e.g. `.git`, `node_modules`, `*.tmp`, `.DS_Store`) in Settings to automatically skip unwanted files during folder crawls and batch transfers.
- **Background Async Deletion with Live Cancel**:
  - Deleting massive folders (such as `node_modules` or `vendor`) runs asynchronously in the background without freezing the UI or blocking file navigation.
  - Real-time floating status card shows item title, completed/total count, and live spinner (with optional fast `rm -rf` over SSH for remote directories).
  - **One-Click Cancel**: Instantly halts recursive deletion loops safely on both local and remote filesystems.
- **Parent Directory Entry (`📁 ..`)**: Classic FileZilla-style parent directory row for swift mouse and keyboard navigation.
- **Path Address Bars**: Direct keyboard path input with auto-completion, copy-path actions, and clickable breadcrumbs.
- **Quick Bookmarks**: Pin frequently visited remote directories (`/var/www`, `/etc`, `~`) and local folders.
- **Selection & Deselection Ergonomics**:
  - Multi-file selection with rubber-band marquee drag selection, <kbd>Shift+Click</kbd>, <kbd>Ctrl/Cmd+Click</kbd>, and <kbd>Ctrl+A</kbd>.
  - **Empty-Space Click to Deselect**: Clicking anywhere on the empty space of the local or remote pane immediately clears all selected files.
  - Pressing <kbd>Esc</kbd> clears selections instantly when no modals are open.
  - Context menu on empty space enables one-click file/folder/symlink creation, pasting, and refreshing.
- **Drag & Drop**:
  - Drag files directly between panes (Local ↔ Remote or Remote ↔ Remote).
  - Drag into subfolders or onto parent `..` directory to drop into parent folders.
  - Native OS drag-and-drop from Windows Explorer / macOS Finder / Linux file managers.
- **WSL (Windows Subsystem for Linux) & Linux Distro Recognition**:
  - Automatic detection of installed WSL distributions (e.g. `Ubuntu`, `Debian`, `Fedora`, `Arch`, `Alpine`, `openSUSE`, `Kali`).
  - Distro-specific brand icons rendered in the breadcrumbs bar and quick navigation dropdowns.
  - One-click jumping to `//wsl.localhost/<distro>` or `\\wsl$\<distro>` directly from the local toolbar.
- **Git Status Indicators**:
  - Visual badges (`M` Modified, `U` Untracked, `S` Staged, `D` Deleted) for local and remote repositories.
  - Active branch indicators in path address bars.

---

### 🛠️ Developer Power Features
- **Edit in External Editor with Live Sync**:
  - Open any remote or local file in **VS Code**, **Cursor AI**, **Sublime Text**, **Notepad++**, or your preferred custom CLI command.
  - Configurable default external editor in **Settings -> External Editor** (`code`, `cursor`, `subl`, `notepad++`, or custom executable path).
  - Remote files are automatically staged in an isolated temporary directory; FlowSFTP launches your editor and attaches a cross-platform filesystem watcher via the asynchronous `notify` crate.
  - **Debounced Instant Auto-Upload**: Whenever you press <kbd>Ctrl+S</kbd> in your editor, changes are debounced (600ms) and automatically synced back to the remote server or local destination.
  - **Live Floating Status Bar**: Real-time status pill (`SftpExternalEditBar`) at the bottom of the window displays actively synced files, live upload spinners, last-synced timestamps, and one-click actions to manually re-sync or stop watching.
  - Clean background session teardown and staged file cleanup on session close or manual stop.
- **Live Directory Watcher & Auto-Upload (Folder Pairing)**:
  - Pair any local project workspace directly with a remote target directory (`SftpDirWatcherModal`).
  - Seamless "edit locally, test remotely" workflow — perfect for web applications, PHP, Python, Node.js, and server-side development.
  - Real-time recursive filesystem monitoring powered by Rust's asynchronous `notify` (v8) channel.
  - **Intelligent Ignore Filtering**: Automatically excludes bulky build directories, caches, and temp files (`.git`, `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `target`, `.idea`, `.vscode`, `*.swp`, `*.tmp`, and user-defined custom glob patterns).
  - Configurable debounce delay (default 800ms) avoids duplicate uploads during rapid saves or multi-file compile cycles.
  - Visual toolbar status pill with live pulsing indicator, change statistics, real-time activity log drawer, and one-click pause / resume controls.
- **Recursive Remote Search & SSH Grep (`Ctrl+Shift+F` / `Cmd+Shift+F`)**:
  - Deep recursive search modal (`SftpSearchModal`) for instantly locating files and code across complex remote directory trees.
  - **Kernel-Speed SSH Grep**: Executes native `find` and `grep -rnI` directly on the remote Linux / Unix host over the SSH channel without downloading files.
  - Search by filename pattern (glob / wildcards like `*.vue`, `app.*`, `*.conf`) or deep full-text string content search with matched line numbers and syntax-highlighted snippets.
  - Case-sensitive and regex matching options with configurable maximum results limits.
  - **FTP / Breadth-First Crawl Fallback**: Gracefully falls back to an asynchronous breadth-first crawler for FTP / FTPS connections or restricted SFTP hosts without shell access.
  - **Live Cancellation & Stop Control**: Instantly abort running searches at any time with the pulsating **Stop** button, by pressing <kbd>Esc</kbd>, or upon closing the modal, preserving and displaying all matches discovered up to that point.
  - **Quick Navigation**: Double-click any search match to open/edit the file immediately or jump directly to its containing remote directory.

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
    - **Close FlowSFTP**: Closes the application cleanly after a 2-second grace period with audio feedback.
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
- **Multi-Session Tabs**: Keep multiple SSH connections open simultaneously with active status indicators and session persistence.
- **"Open in Terminal" Integration**: One-click jump from any remote SFTP folder straight into the SSH terminal (`cd '/path/to/folder'`).
- **In-Terminal Search & Zoom**: Built-in terminal search bar, dynamic font zoom (<kbd>Ctrl</kbd>+<kbd>=</kbd>, <kbd>Ctrl</kbd>+<kbd>-</kbd>, <kbd>Ctrl</kbd>+<kbd>0</kbd>), and right-click copy/paste.
- **Customizable Cursor & Scrollback**: Configurable cursor style (`block`, `underline`, `bar`), cursor blink toggle, scrollback buffer size, and native system monospace font detection.
- **Fit Addon**: Automatically synchronizes terminal rows and columns with window resize events.

---

### 🛡️ Protocols & Security
- **Protocols Supported**:
  - **SFTP** (over SSH) powered by Rust's asynchronous `russh` and `russh-sftp`.
  - **FTP / FTPS** (TLS/SSL encryption) powered by `suppaftp` with automatic dropped connection recovery and seamless file browsing.
  - **SSH Shell** for interactive terminal sessions.
- **SSH Host-Key Verification (TOFU — Trust On First Use)**:
  - Interactive host-key verification prompt (`HostKeyPromptModal`) when connecting to an unknown SSH host or when a server's public key changes.
  - Displays key algorithm (`ssh-ed25519`, `rsa-sha2-256`, etc.) and `SHA256` fingerprint, with prominent security warnings if a previously trusted key has changed (MITM protection).
  - Atomic persistent host-key store (`known_hosts.json`) managed by the Rust backend.
- **Connection Profiles & Group Folders**:
  - Organize server bookmarks into custom named folders / groups.
  - One-click folder creation, inline folder renaming, and quick profile management.
- **Master Password & Encrypted Vault**:
  - Protect saved credentials with WebCrypto **PBKDF2** (100,000 iterations, SHA-256) key derivation and **AES-GCM** (256-bit) authenticated encryption.
  - Configurable auto-lock timeout, manual vault lock/unlock (`MasterPasswordModal`), and master password change & reset workflows.
- **OS Native Keyring Support**: Integration with Windows Credential Manager, macOS Keychain, and Linux Secret Service via the `keyring` crate.
- **Authentication Methods**:
  - Password authentication.
  - **SSH Private Keys**: OpenSSH, RSA, and Ed25519 formats with passphrase decryption.
  - **PuTTY Private Keys (.ppk)**: Native support for PuTTY `.ppk` v2 and v3 private keys without external conversion.
  - Custom SSH ports and connection timeouts.

---

### 📝 Integrated Tools
- **Built-in Code Editor (`FileEditorModal` — CodeMirror 6 + Full Vim Mode)**:
  - Edit remote and local files directly in-app across SFTP, FTP, FTPS, and local filesystems.
  - **100+ Language Grammars**: Automatic syntax highlighting and language detection by filename/extension powered by `@codemirror/language-data`.
  - **Dynamic Theme-Synchronized Highlighting**: Automatically constructs a custom CodeMirror 6 theme and Lezer syntax highlighter from the active FlowSFTP UI & terminal palette, updating on the fly when switching themes or changing font settings.
  - **First-Class Vim Mode (`@replit/codemirror-vim`)**:
    - One-click **VIM** mode toggle in the editor header (persisted across sessions in Settings).
    - Live Vim mode badge (`NORMAL`, `INSERT`, `VISUAL`) displayed in both the editor header and footer status bar.
    - Built-in Ex command support (`:w`, `:write`, `:wq`, `:x`, `:q`, `:quit`, `:q!`) and `/` incremental search.
    - Smart <kbd>Esc</kbd> and <kbd>Ctrl</kbd>+<kbd>[</kbd> handling (transitions from Insert/Visual mode back to Normal mode without closing the editor modal) and mode-aware <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indentation.
  - **Rich Editor Ergonomics**:
    - Custom themed right-click context menu (`Cut`, `Copy`, `Paste`, `Undo`, `Redo`, `Select All`, `Format / Indent Selection`, `Find / Replace`).
    - Full-window **Maximize / Restore** toggle and **Revert** button with unsaved-changes (`Modified`) protection.
    - One-click **"Open in External Editor"** handoff to transition from the built-in editor directly into VS Code / Cursor / Sublime with live sync.
    - Live footer status bar displaying cursor coordinates (`Ln X, Col Y`), line count, character count, UTF-8 encoding, and detected language.
  - Auto-upload and directory cache invalidation on save (<kbd>Ctrl+S</kbd> / `:w`).
- **Quick Look Instant Preview (<kbd>Spacebar</kbd>)**:
  - macOS-inspired file preview for instant file inspection across SFTP, FTP, FTPS, and local directories (including remote left-pane sessions).
  - Full preview support for:
    - **Markdown** (with Rendered vs. Raw source toggle)
    - **JSON** (auto-formatted with syntax highlighting)
    - **Source Code & Plain Text** (with sticky line numbers)
    - **Images & SVGs** (with interactive `25%`–`400%` zoom controls and transparency checkerboard)
    - **PDF Documents** (embedded viewer)
    - **Audio** (`mp3`, `wav`, `ogg`, `flac`, `aac`, `m4a` with native playback controls)
    - **Video** (`mp4`, `webm`, `mov`, `mkv` with native video player)
  - Navigate between files seamlessly using <kbd>←</kbd> / <kbd>→</kbd> or <kbd>↑</kbd> / <kbd>↓</kbd> arrow keys.
- **Permissions Modal (chmod)**:
  - Interactive Unix permission calculator with checkboxes (Read, Write, Execute for Owner, Group, Public).
  - Octal representation editor (e.g. `0755`, `0644`) and recursive directory application (`chmod -R` with symlink loop protection).
- **High-Throughput Queue Worker**:
  - **Multi-Worker Concurrency**: Configurable parallel transfer workers via a dedicated task pump (`taskPump.ts`).
  - **Directory Flattening**: Pre-scans nested folders into flat task queues with live crawl progress (`sftp:crawl:progress`) so parallel workers stay 100% utilized.
  - **Batch Processing**: Transfers entire file batches without thrashing per-file directory listings, preventing UI freezes and connection timeouts. Refreshes once upon batch completion.
- **Connection Health & Auto-Reconnect**:
  - Heartbeat background polling every 25 seconds.
  - Sleep-wake detection and automatic reconnect countdown on dropped connections.

---

### 🎨 Customization & Theming
- **Catppuccin Flow Ribbon Branding**: Custom-crafted Flow Ribbon emblem and squircle application icons aligned with the Catppuccin color scheme with transparent margins.
- **10 Built-in Curated Theme Palettes + Custom JSON Themes**:
  - **Catppuccin**: Mocha, Latte (plus Default dark palette).
  - **Developer Classics**: Tokyo Night, Dracula, Nord, One Dark, Monokai Pro, GitHub Dark, and GitHub Light.
  - **Custom Theme Import / Export**: Import, validate, and export custom JSON theme definitions covering both UI chrome and ANSI terminal colors.
- **Interactive Keymap Editor**:
  - Customize and rebind application keyboard shortcuts in **Settings -> Keymap** with real-time shortcut conflict detection and one-click reset to defaults.
- **100% Theme Consistency**:
  - Dynamically styled toast notifications (top-center and bottom-right floating messages).
  - Themed background deletion and auto-sync status pills.
  - Consistent context menus, including empty-pane right-click states.
- **Native Window Dragging**:
  - Click and drag freely anywhere across the custom topbar (`data-tauri-drag-region`) to move the window between displays.
  - Themed minimize, maximize/restore, and close buttons integrated into the titlebar.
- **File & Folder Icons**: Rich file type icons powered by Catppuccin file icons and Lucide icons.
- **Row Density Options**: Compact, Normal, and Relaxed row heights.
- **Custom System Fonts**: Automatic OS monospace font enumeration (`fonts.rs`) with configurable font families and sizes for file listings, code editor, and terminal.

---

## ⌨️ Keyboard Shortcuts

> All shortcuts below can be customized in **Settings → Keymap**.

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| <kbd>F5</kbd> / <kbd>Ctrl</kbd> + <kbd>R</kbd> | File Browser | Refresh active directory listing (<kbd>Ctrl</kbd> + <kbd>F5</kbd> for both) |
| <kbd>F2</kbd> | File Browser | Rename selected file or folder |
| <kbd>F6</kbd> | File Browser | Move selected file(s) to the opposite pane |
| <kbd>F7</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> | File Browser | Create new folder in active pane |
| <kbd>Ctrl</kbd> + <kbd>X</kbd> / <kbd>Ctrl</kbd> + <kbd>C</kbd> / <kbd>Ctrl</kbd> + <kbd>V</kbd> | File Browser | Cut, Copy, and Paste files across Local and Remote panes |
| <kbd>Ctrl</kbd> + <kbd>D</kbd> / <kbd>⌘</kbd> + <kbd>D</kbd> | File Browser | Duplicate selected file or directory |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> / <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> | Remote / Global | Open Recursive Remote Search & SSH Grep |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> / <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | File Browser | Toggle Directory Comparison Mode |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> / <kbd>⌘</kbd> + <kbd>F</kbd> | File Browser | Toggle In-Pane Live Filter |
| <kbd>Space</kbd> | File Browser | Quick Look / Instant Preview |
| <kbd>Enter</kbd> | File Browser | Open folder / edit file (or select first filter match) |
| <kbd>↓</kbd> / <kbd>↑</kbd> / <kbd>Home</kbd> / <kbd>End</kbd> | File Browser | Navigate file rows |
| <kbd>Backspace</kbd> / <kbd>Alt</kbd> + <kbd>↑</kbd> | File Browser | Navigate to parent directory (`..`) |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> / <kbd>⌘</kbd> + <kbd>A</kbd> | File Browser | Select all files in active pane |
| <kbd>Delete</kbd> | File Browser | Delete selected file(s) (with async background cancel) |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>⌘</kbd> + <kbd>S</kbd> (or `:w` in Vim) | Code Editor | Save and upload file |
| <kbd>Ctrl</kbd> + <kbd>W</kbd> / <kbd>⌘</kbd> + <kbd>W</kbd> (or `:q` in Vim) | Code Editor | Close editor modal |
| <kbd>Esc</kbd> / <kbd>Ctrl</kbd> + <kbd>[</kbd> | Code Editor (Vim) | Exit Insert / Visual mode back to Normal mode |
| <kbd>Esc</kbd> | Global | Close modals, clear filter, dismiss preview, or deselect all items |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> / <kbd>Ctrl</kbd> + <kbd>,</kbd> | Global | Open Settings & Keymap |
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
  - `notify` (v8) — Cross-platform filesystem watcher for external editor live sync & folder pairing
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

#### Linux Dependencies
Install the required development libraries for WebKit2GTK 4.1, GTK 3, OpenSSL, and AppIndicator based on your Linux distribution:

- **Debian / Ubuntu / Linux Mint / Pop!_OS**:
  ```bash
  sudo apt update
  sudo apt install -y \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libxdo-dev
  ```

- **Fedora / RHEL**:
  ```bash
  sudo dnf groupinstall -y "Development Tools"
  sudo dnf install -y \
    webkit2gtk4.1-devel \
    openssl-devel \
    curl \
    wget \
    file \
    gtk3-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel \
    libxdo-devel
  ```

- **Arch Linux / Manjaro**:
  ```bash
  sudo pacman -Syu --needed \
    base-devel \
    curl \
    wget \
    file \
    openssl \
    gtk3 \
    webkit2gtk-4.1 \
    libappindicator-gtk3 \
    librsvg \
    xdotool
  ```

- **openSUSE (Tumbleweed / Leap)**:
  ```bash
  sudo zypper install -t pattern devel_basis
  sudo zypper install -y \
    webkit2gtk-4.1-devel \
    libopenssl-devel \
    gtk3-devel \
    libappindicator3-devel \
    librsvg-devel
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
git clone https://github.com/digitalcodelabs/flowsftp.git
cd flowsftp
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
To compile the optimized Rust release binary and bundle platform installers:

```bash
npm run tauri:build
```

The output artifacts will be generated in:
```
src-tauri/target/release/bundle/
```

- **Windows**: `.exe` (NSIS installer) and `.msi`
- **macOS**: `.dmg` and `.app`
- **Linux**: `.deb` package and `.AppImage` standalone binary

---

### 🐧 Building & Running on Linux

FlowSFTP compiles and runs natively across all modern Linux distributions.

#### 1. Quick Build (AppImage & Debian Package)
After installing the [Linux Dependencies](#linux-dependencies), run:

```bash
npm run tauri:build
```

The compiled bundles will be generated under `src-tauri/target/release/bundle/`:
```bash
# Debian / Ubuntu / Linux Mint (.deb)
sudo dpkg -i src-tauri/target/release/bundle/deb/flowsftp_*_amd64.deb

# Universal Standalone (.AppImage)
chmod +x src-tauri/target/release/bundle/appimage/flowsftp_*_amd64.AppImage
./src-tauri/target/release/bundle/appimage/flowsftp_*_amd64.AppImage
```

#### 2. Development Mode on Linux
To run with live hot reloading during development:
```bash
npm run tauri:dev
```

#### 3. Linux Desktop Environment Tips
- **Wayland / WebKit Compositing**: If you experience WebKit rendering glitches or black windows on certain graphics drivers (or inside Linux VMs), launch with software compositing:
  ```bash
  WEBKIT_DISABLE_COMPOSITING_MODE=1 ./flowsftp
  ```
- **Force X11 Backend**: To force X11 compatibility mode under Wayland:
  ```bash
  GDK_BACKEND=x11 ./flowsftp
  ```

---

### Validation, Type Checking & Automated Tests
To run the automated unit test suites and TypeScript verification:
```bash
# Run frontend Vitest unit tests
npm test

# Run Rust backend unit tests
npm run test:rust

# Run Nuxt / Vue TypeScript type checker
npm run typecheck

# Validate frontend production bundle
npm run build
```

---

## 📂 Project Structure

```
flowsftp/
├── app/                         # Frontend application (Nuxt 4 / Vue 3)
│   ├── app.vue                  # Main application shell & tab router
│   ├── components/              # Vue components
│   │   ├── SftpBrowser.vue      # Dual-pane SFTP & local file manager
│   │   ├── SshTerminal.vue      # xterm.js WebGL SSH terminal
│   │   ├── FileEditorModal.vue  # CodeMirror 6 code editor with full Vim mode
│   │   ├── QuickLookModal.vue   # macOS-style instant file preview (MD, JSON, PDF, Media, Code)
│   │   ├── ConnectionManagerModal.vue # Connection profiles, folders & vault
│   │   ├── HostKeyPromptModal.vue     # SSH host-key verification (TOFU) prompt
│   │   ├── MasterPasswordModal.vue    # Encrypted vault unlock dialog
│   │   ├── PermissionsModal.vue       # Unix chmod visual calculator
│   │   ├── SettingsModal.vue          # App settings, keymap editor & themes
│   │   └── sftp/                # SFTP panes, modals, composables, and queue
│   │       ├── SftpExternalEditBar.vue   # Floating status bar for external editor live sync
│   │       ├── compare/                  # Directory comparison diff badges & bar
│   │       ├── composables/
│   │       │   ├── useModalEscape.ts     # Reusable Esc key modal dismiss composable
│   │       │   ├── useSftpDragDrop.ts    # Pane & OS drag-and-drop coordinator
│   │       │   └── useSftpKeyboardNav.ts # Arrow key, Enter, Backspace navigation
│   │       ├── contextmenu/
│   │       │   └── SftpContextMenu.vue   # Context menu for local and remote panes
│   │       ├── modals/
│   │       │   ├── SftpChecksumModal.vue   # SHA-256 & MD5 checksum verifier
│   │       │   ├── SftpConflictModal.vue   # File conflict resolution dialog
│   │       │   ├── SftpDirWatcherModal.vue # Directory watcher & folder pairing modal
│   │       │   ├── SftpNewSymlinkModal.vue # Symbolic link creation dialog
│   │       │   ├── SftpSearchModal.vue     # Recursive remote search & SSH grep modal
│   │       │   ├── SftpCompressModal.vue   # Archive compression dialog
│   │       │   └── SftpExtractModal.vue    # Archive extraction dialog
│   │       ├── panes/           # Local and remote browser panes & breadcrumbs
│   │       └── queue/           # FileZilla-exact 3-tab transfer queue drawer
│   ├── lib/
│   │   └── sftp/                # Modular SFTP domain composables & types
│   │       ├── pane.ts                  # PaneRef abstraction (local vs. remote session)
│   │       ├── useDirectoryBrowser.ts   # Directory fetching, TTL cache & home resolution
│   │       ├── useFileOperations.ts     # File/folder CRUD, cut/copy/paste, archives & chmod
│   │       ├── useTransferPipeline.ts   # Single & batch upload/download/remote-to-remote pipeline
│   │       ├── useTransferQueue.ts      # Queue scheduling, concurrency & priority management
│   │       └── useConflictResolution.ts # Serialized conflict prompt state machine
│   ├── stores/                  # Pinia state stores
│   │   ├── sftp.ts              # Unified SFTP store facade
│   │   ├── ssh.ts               # SSH/FTP session management & host-key prompts
│   │   ├── keychain.ts          # Connection profile metadata & OS keyring bridge
│   │   ├── vault.ts             # PBKDF2 + AES-GCM encrypted credential vault
│   │   ├── externalEdit.ts      # External editor watcher & live sync state
│   │   ├── dirWatcher.ts        # Folder pairing & background sync state
│   │   ├── settings.ts          # Density, fonts, keymaps, ignore patterns, editor config
│   │   └── theme.ts             # Built-in & custom JSON theme palettes
│   └── utils/                   # Keymap, task pump, formatters, and file icon helpers
│       ├── conflict.ts          # Conflict comparison & auto-rename utilities
│       ├── taskPump.ts          # Concurrent worker pool pump
│       ├── transferItems.ts     # Transfer queue item builders
│       ├── keymap.ts            # Keyboard shortcut matcher & formatter
│       ├── formatters.ts        # formatBytes, formatDate, isArchiveFile, highlightMatch
│       └── fileIcons.ts         # Catppuccin file and folder icon resolvers
│
├── src-tauri/                   # Rust backend (Tauri v2)
│   ├── Cargo.toml               # Rust dependencies
│   ├── tauri.conf.json          # Tauri application configuration
│   └── src/
│       ├── main.rs              # Tauri binary entry
│       ├── lib.rs               # Library entry & command registration
│       ├── shell.rs             # POSIX single-quote shell escaping helpers
│       ├── state.rs             # Shared application state
│       ├── ssh/                 # SSH client, PTY session, exec & TOFU known_hosts store
│       ├── ftp/                 # FTP / FTPS client with TLS & streaming transfers
│       ├── keychain/            # Atomic profile storage & OS native keyring manager
│       ├── sftp/                # SFTP, watcher, external edit, and search engines
│       │   ├── mod.rs           # Core SFTP/local operations, streaming transfers & archives
│       │   ├── dir_watcher.rs   # Recursive directory watcher & auto-sync engine
│       │   ├── external_edit.rs # External editor launcher & file change monitor
│       │   └── search.rs        # Native SSH grep & BFS directory search
│       └── commands/            # Tauri IPC command modules
│
├── tests/                       # Vitest unit & characterization test suites
├── package.json                 # Node dependencies and scripts
├── nuxt.config.ts               # Nuxt 4 configuration
└── tailwind.config.js           # Tailwind CSS configuration
```

---

## 🏢 Developed & Maintained By

**digital code labs s.r.l.**

- 🌐 **Website**: [https://digitalcodelabs.dev](https://digitalcodelabs.dev)
- 📧 **Inquiries**: [contact@digitalcodelabs.dev](mailto:contact@digitalcodelabs.dev)
- 📬 **Direct Contact**: [dan@spiral8.net](mailto:dan@spiral8.net)

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

This project is distributed under the MIT License — Copyright (c) 2026 **digital code labs s.r.l.**  
See the full [LICENSE](LICENSE) file for details.

