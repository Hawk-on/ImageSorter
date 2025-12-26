//! Filskanner for å finne bilder i mapper

use std::path::Path;
use walkdir::WalkDir;

/// Representerer et bilde funnet under skanning
#[derive(Debug, Clone)]
pub struct ImageInfo {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size_bytes: u64,
}

/// Støttede bildeformater
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "ico", "heic", "heif",
];

/// Skanner en mappe rekursivt og returnerer alle bilder
pub fn scan_directory(path: &str) -> Result<Vec<ImageInfo>, Box<dyn std::error::Error>> {
    let path = Path::new(path);

    if !path.exists() {
        return Err(format!("Mappen finnes ikke: {}", path.display()).into());
    }

    if !path.is_dir() {
        return Err(format!("Stien er ikke en mappe: {}", path.display()).into());
    }

    let mut images = Vec::new();

    for entry in WalkDir::new(path).follow_links(true).into_iter().flatten() {
        let entry_path = entry.path();

        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();

                if SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str()) {
                    if let Ok(metadata) = entry.metadata() {
                        let filename = entry_path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_default();

                        images.push(ImageInfo {
                            path: entry_path.to_string_lossy().to_string(),
                            filename,
                            extension: ext_lower,
                            size_bytes: metadata.len(),
                        });
                    }
                }
            }
        }
    }

    Ok(images)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions() {
        assert!(SUPPORTED_EXTENSIONS.contains(&"jpg"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"png"));
        assert!(!SUPPORTED_EXTENSIONS.contains(&"txt"));
    }
}
