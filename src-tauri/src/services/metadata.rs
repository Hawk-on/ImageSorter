//! Tjeneste for å lese metadata fra bilder (EXIF)

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// prøver å lese opprettelsesdato fra bildet
/// 1. Sjekker EXIF (DateTimeOriginal)
/// 2. Faller tilbake til filsystemets endringsdato (mtime)
pub fn read_creation_date(path: &Path) -> Option<DateTime<Local>> {
    // 1. Prøv å lese EXIF
    if let Some(date) = read_exif_date(path) {
        return Some(Local.from_local_datetime(&date).unwrap());
    }

    // 2. Fallback til filsystem mtime
    read_file_mtime(path)
}

fn read_exif_date(path: &Path) -> Option<NaiveDateTime> {
    let file = File::open(path).ok()?;
    let mut bufreader = BufReader::new(&file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader).ok()?;

    // Prøv forskjellige datofelt i prioritert rekkefølge
    let date_fields = [
        exif::Tag::DateTimeOriginal,
        exif::Tag::DateTimeDigitized,
        exif::Tag::DateTime,
    ];

    for tag in date_fields {
        if let Some(field) = exif.get_field(tag, exif::In::PRIMARY) {
            if let exif::Value::Ascii(ref vec) = field.value {
                if !vec.is_empty() {
                    let s = std::str::from_utf8(&vec[0]).ok()?;
                    // EXIF datoformat: "YYYY:MM:DD HH:MM:SS"
                    // Vi erstatter første to : med - for å matche ISO 8601 delvis
                    // Eller bruke chrono sitt format direkte
                    if let Ok(date) = NaiveDateTime::parse_from_str(s, "%Y:%m:%d %H:%M:%S") {
                        return Some(date);
                    }
                }
            }
        }
    }

    None
}

fn read_file_mtime(path: &Path) -> Option<DateTime<Local>> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let datetime: DateTime<Local> = modified.into();
    Some(datetime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_fallback_to_mtime() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test_no_exif.txt");
        File::create(&file_path).unwrap().write_all(b"test").unwrap();

        let date = read_creation_date(&file_path);
        assert!(date.is_some());
        
        // Sjekk at datoen er nylig (innenfor siste minutt)
        let now = Local::now();
        let diff = now.signed_duration_since(date.unwrap());
        assert!(diff.num_seconds().abs() < 60);
    }
}
