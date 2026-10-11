use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SystemFont {
    pub name: String,
    pub is_monospace: bool,
}

/// Detects if a font is likely monospace based on common naming conventions
pub fn is_monospace_font(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("mono")
        || lower.contains("code")
        || lower.contains("console")
        || lower.contains("terminal")
        || lower.contains("courier")
        || lower.contains("fixed")
        || lower.contains("typewriter")
        || lower.contains("cascadia")
        || lower.contains("jetbrains")
        || lower.contains("fira")
        || lower.contains("hack")
        || lower.contains("inconsolata")
        || lower.contains("menlo")
        || lower.contains("monaco")
        || lower.contains("iosevka")
        || lower.contains("source code")
        || lower.contains("dejavu sans mono")
        || lower.contains("liberation mono")
        || lower.contains("terminus")
        || lower.contains("hasklig")
        || lower.contains("victor")
}

#[cfg(target_os = "windows")]
pub fn fetch_system_fonts() -> Vec<SystemFont> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut names = BTreeSet::new();

    let registry_roots = [
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    ];

    for reg_path in registry_roots {
        let mut cmd = Command::new("reg");
        cmd.args(["query", reg_path]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(output) = cmd.output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("HKEY_") {
                        continue;
                    }

                    // Format: "Font Name (TrueType)    REG_SZ    filename.ttf"
                    let font_part = if let Some(idx) = trimmed.find("    REG_") {
                        &trimmed[..idx]
                    } else if let Some(idx) = trimmed.find("\tREG_") {
                        &trimmed[..idx]
                    } else {
                        trimmed
                    };

                    let cleaned_entries = clean_windows_font_name(font_part);
                    for item in cleaned_entries {
                        if !item.is_empty() {
                            names.insert(item);
                        }
                    }
                }
            }
        }
    }

    // Also include common fallback fonts if missing
    let fallbacks = [
        "Consolas",
        "Cascadia Code",
        "Cascadia Mono",
        "Courier New",
        "Segoe UI",
        "Arial",
    ];
    for f in fallbacks {
        names.insert(f.to_string());
    }

    names
        .into_iter()
        .map(|name| {
            let is_monospace = is_monospace_font(&name);
            SystemFont { name, is_monospace }
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn fetch_system_fonts() -> Vec<SystemFont> {
    use std::collections::BTreeSet;
    use std::fs;
    let mut names = BTreeSet::new();

    let font_dirs = [
        "/System/Library/Fonts",
        "/Library/Fonts",
    ];

    for dir in font_dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Ok(file_name) = entry.file_name().into_string() {
                    let lower = file_name.to_lowercase();
                    if lower.ends_with(".ttf") || lower.ends_with(".otf") || lower.ends_with(".ttc") {
                        let stem = file_name
                            .trim_end_matches(".ttf")
                            .trim_end_matches(".otf")
                            .trim_end_matches(".ttc");
                        if !stem.is_empty() {
                            names.insert(stem.to_string());
                        }
                    }
                }
            }
        }
    }

    let fallbacks = ["Menlo", "Monaco", "SF Mono", "Courier New", "-apple-system"];
    for f in fallbacks {
        names.insert(f.to_string());
    }

    names
        .into_iter()
        .map(|name| {
            let is_monospace = is_monospace_font(&name);
            SystemFont { name, is_monospace }
        })
        .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn fetch_system_fonts() -> Vec<SystemFont> {
    use std::process::Command;
    let mut names = BTreeSet::new();

    if let Ok(output) = Command::new("fc-list").arg(":").arg("family").output() {
        if let Ok(text) = String::from_utf8(output.stdout) {
            for line in text.lines() {
                for part in line.split(',') {
                    let trimmed = part.trim();
                    if !trimmed.is_empty() {
                        names.insert(trimmed.to_string());
                    }
                }
            }
        }
    }

    let fallbacks = ["DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Monospace"];
    for f in fallbacks {
        names.insert(f.to_string());
    }

    names
        .into_iter()
        .map(|name| {
            let is_monospace = is_monospace_font(&name);
            SystemFont { name, is_monospace }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn clean_windows_font_name(raw: &str) -> Vec<String> {
    // Strip file format extensions in parentheses like " (TrueType)", " (OpenType)"
    let stripped = if let Some(idx) = raw.rfind('(') {
        let inside = &raw[idx..];
        if inside.contains("TrueType")
            || inside.contains("OpenType")
            || inside.contains("Type 1")
            || inside.contains("All capabilities")
        {
            raw[..idx].trim()
        } else {
            raw.trim()
        }
    } else {
        raw.trim()
    };

    // If it contains " & ", e.g. "Cambria & Cambria Math"
    let parts: Vec<&str> = stripped.split(" & ").collect();
    let mut results = Vec::new();

    for p in parts {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Strip common style suffixes
        let style_suffixes = [
            " Bold Italic",
            " Light Italic",
            " Medium Italic",
            " SemiBold Italic",
            " ExtraBold Italic",
            " Black Italic",
            " ExtraLight Italic",
            " Heavy Italic",
            " Thin Italic",
            " Regular",
            " Bold",
            " Italic",
            " Light",
            " Medium",
            " SemiBold",
            " ExtraBold",
            " Black",
            " ExtraLight",
            " Heavy",
            " Thin",
            " Demi",
            " Book",
            " Oblique",
        ];

        let mut cleaned = trimmed.to_string();
        for suffix in style_suffixes {
            if cleaned.ends_with(suffix) {
                let candidate = cleaned[..cleaned.len() - suffix.len()].trim();
                if !candidate.is_empty() {
                    cleaned = candidate.to_string();
                    break;
                }
            }
        }

        if !cleaned.is_empty() {
            results.push(cleaned);
        }
    }

    results
}

#[tauri::command]
pub async fn get_system_fonts() -> Result<Vec<SystemFont>, String> {
    tokio::task::spawn_blocking(fetch_system_fonts)
        .await
        .map_err(|e| format!("Failed to fetch system fonts: {}", e))
}
