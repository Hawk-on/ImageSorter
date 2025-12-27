use std::path::Path;
use std::fs;
use crate::services::metadata;
use chrono::Datelike;
use serde::{Serialize, Deserialize};
use trash;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub processed: usize,
    pub success: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
}

impl OperationResult {
    pub fn new() -> Self {
        Self {
            processed: 0,
            success: 0,
            errors: 0,
            error_messages: Vec::new(),
        }
    }

    pub fn add_success(&mut self) {
        self.success += 1;
    }

    pub fn add_error(&mut self, msg: String) {
        self.errors += 1;
        self.error_messages.push(msg);
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SortConfig {
    pub use_day_folder: bool,
    pub use_month_names: bool,
}

pub fn sort_images(
    paths: Vec<String>,
    target_dir: &str,
    method: &str, // "copy" eller "move"
    config: SortConfig
) -> OperationResult {
    let mut result = OperationResult::new();
    result.processed = paths.len();
    let target_path = Path::new(target_dir);

    if !target_path.exists() {
        result.add_error(format!("Målmappen finnes ikke: {}", target_dir));
        return result;
    }

    let month_names = [
        "Januar", "Februar", "Mars", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Desember"
    ];

    for path_str in paths {
        let source_path = Path::new(&path_str);
        
        if !source_path.exists() {
             result.add_error(format!("Fil finnes ikke: {}", path_str));
             continue;
        }

        let date = match metadata::read_creation_date(source_path) {
            Some(d) => d,
            None => {
                result.add_error(format!("Kunne ikke lese dato for: {}", path_str));
                continue;
            }
        };

        let year = date.year();
        let month = date.month();
        let day = date.day();

        let month_folder = if config.use_month_names {
            format!("{:02} - {}", month, month_names[(month - 1) as usize])
        } else {
            format!("{:02}", month)
        };

        let mut dest_dir = target_path.join(format!("{}", year)).join(month_folder);
        
        if config.use_day_folder {
            dest_dir = dest_dir.join(format!("{:02}", day));
        }

        if let Err(e) = fs::create_dir_all(&dest_dir) {
             result.add_error(format!("Kunne ikke opprette mappe {:?}: {}", dest_dir, e));
             continue;
        }

        let filename = source_path.file_name().unwrap_or_default();
        let mut dest_path = dest_dir.join(filename);

        // Håndter filnavn-kollisjoner: img.jpg -> img_1.jpg
        let mut counter = 1;
        while dest_path.exists() {
            let stem = source_path.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source_path.extension().unwrap_or_default().to_string_lossy();
            let new_filename = if ext.is_empty() {
                format!("{}_{}", stem, counter)
            } else {
                format!("{}_{}.{}", stem, counter, ext)
            };
            dest_path = dest_dir.join(new_filename);
            counter += 1;
        }

        let op_result = if method == "move" {
            fs::rename(source_path, &dest_path)
        } else {
            fs::copy(source_path, &dest_path).map(|_| ())
        };

        match op_result {
            Ok(_) => result.add_success(),
            Err(e) => result.add_error(format!("Kunne ikke {} fil {}: {}", method, path_str, e)),
        }
    }

    result
}

pub fn delete_images(paths: Vec<String>) -> OperationResult {
    let mut result = OperationResult::new();
    result.processed = paths.len();

    for path_str in paths {
        let path = Path::new(&path_str);
        if !path.exists() {
             result.add_error(format!("Fil finnes ikke: {}", path_str));
             continue;
        }

        // Prøv å bruke trash først
        match trash::delete(path) {
            Ok(_) => result.add_success(),
            Err(e) => {
                // Hvis trash feiler, logg feilen - vi sletter IKKE permanent automatisk som fallback
                // for sikkerhets skyld.
                result.add_error(format!("Kunne ikke flytte til papirkurv: {}. Permanent sletting ikke utført av sikkerhetshensyn.", e));
            }
        }
    }
    result
}

pub fn move_images(paths: Vec<String>, target_dir: &str) -> OperationResult {
    let mut result = OperationResult::new();
    result.processed = paths.len();
    let target_path = Path::new(target_dir);

    // Klonet logikk fra sort_images (håndterer kollisjoner), uten dato-mappe opprettelse
    if !target_path.exists() {
         result.add_error(format!("Målmappen finnes ikke: {}", target_dir));
         return result;
    }

    for path_str in paths {
        let source_path = Path::new(&path_str);
        if !source_path.exists() {
            result.add_error(format!("Fil finnes ikke: {}", path_str));
            continue;
        }

        let filename = source_path.file_name().unwrap_or_default();
        let mut dest_path = target_path.join(filename);

        // Kollisjonshåndtering
        let mut counter = 1;
        while dest_path.exists() {
            let stem = source_path.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source_path.extension().unwrap_or_default().to_string_lossy();
             let new_filename = if ext.is_empty() {
                format!("{}_{}", stem, counter)
            } else {
                format!("{}_{}.{}", stem, counter, ext)
            };
            dest_path = target_path.join(new_filename);
            counter += 1;
        }

        match fs::rename(source_path, &dest_path) {
            Ok(_) => result.add_success(),
            Err(e) => result.add_error(format!("Kunne ikke flytte fil {}: {}", path_str, e)),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    fn create_dummy_file(dir: &Path, name: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        File::create(&path).unwrap();
        path
    }

    #[test]
    fn test_move_images() {
        let temp_dir = TempDir::new().unwrap();
        let source_dir = temp_dir.path().join("source");
        let target_dir = temp_dir.path().join("target");
        fs::create_dir(&source_dir).unwrap();
        fs::create_dir(&target_dir).unwrap();

        let file1 = create_dummy_file(&source_dir, "test1.jpg");
        let file2 = create_dummy_file(&source_dir, "test2.jpg");
        
        // Test move
        let paths = vec![
            file1.to_string_lossy().to_string(), 
            file2.to_string_lossy().to_string()
        ];
        
        let result = move_images(paths, target_dir.to_str().unwrap());
        
        assert_eq!(result.success, 2);
        assert_eq!(result.errors, 0);
        assert!(target_dir.join("test1.jpg").exists());
        assert!(target_dir.join("test2.jpg").exists());
        assert!(!source_dir.join("test1.jpg").exists());
    }

    #[test]
    fn test_move_images_collision() {
        let temp_dir = TempDir::new().unwrap();
        let source = temp_dir.path().join("source");
        let target = temp_dir.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();

        let src_file = create_dummy_file(&source, "image.jpg");
        let _existing = create_dummy_file(&target, "image.jpg"); // Create collision

        let result = move_images(
            vec![src_file.to_string_lossy().to_string()], 
            target.to_str().unwrap()
        );

        assert_eq!(result.success, 1);
        assert!(target.join("image.jpg").exists());
        assert!(target.join("image_1.jpg").exists()); // Should be renamed
    }

    // Merk: Vi tester ikke delete_images med trash crate her da det krever GUI environment
    // og kan være flaky i test-miljøer.
}
