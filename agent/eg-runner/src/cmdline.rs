//! Builds a Windows command line that the C runtime splits back into the same argv.

fn quote(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\x0b', '"']) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                // Backslashes before a quote are doubled, plus one to escape the quote.
                out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    // Backslashes before the closing quote are doubled.
    out.extend(std::iter::repeat_n('\\', backslashes * 2));
    out.push('"');
}

pub fn join(argv: &[String]) -> String {
    let mut out = String::new();
    for (i, arg) in argv.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        quote(arg, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn j(args: &[&str]) -> String {
        join(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn plain_args_are_not_quoted() {
        assert_eq!(j(&["gcc", "-O2", "C:\\a\\b.c"]), r"gcc -O2 C:\a\b.c");
    }

    #[test]
    fn quotes_spaces_and_empty() {
        assert_eq!(
            j(&["C:\\Program Files\\x.exe", ""]),
            r#""C:\Program Files\x.exe" """#
        );
    }

    #[test]
    fn escapes_quotes_and_trailing_backslashes() {
        assert_eq!(j(&[r#"say "hi""#]), r#""say \"hi\"""#);
        assert_eq!(j(&[r"a b\"]), r#""a b\\""#);
        assert_eq!(j(&[r#"a\"b"#]), r#""a\\\"b""#);
    }
}
