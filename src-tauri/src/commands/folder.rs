//! Kommandoer for mappehåndtering og duplikatdeteksjon

use crate::services::{hashing, scanner, thumbnail};
use rayon::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub image_count: usize,
    pub total_size_bytes: u64,
    pub images: Vec<ImageInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageWithHash {
    pub info: ImageInfo,
    pub hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub images: Vec<ImageInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateResult {
    pub groups: Vec<DuplicateGroup>,
    pub total_duplicates: usize,
    pub processed: usize,
    pub errors: usize,
}

/// Henter cache-mappe for thumbnails
/// Bruker systemets midlertidige mappe for OS-agnostisk støtte (Windows/Linux/macOS)
fn get_thumbnail_cache_dir() -> PathBuf {
    std::env::temp_dir().join("imagesorter-thumbnails")
}

/// Skanner en mappe og returnerer informasjon om bildene som ble funnet
#[tauri::command]
pub async fn scan_folder(path: String) -> Result<ScanResult, String> {
    let images = scanner::scan_directory(&path).map_err(|e| e.to_string())?;

    let total_size: u64 = images.iter().map(|img| img.size_bytes).sum();
    
    let image_infos: Vec<ImageInfo> = images
        .into_iter()
        .map(|img| ImageInfo {
            path: img.path,
            filename: img.filename,
            size_bytes: img.size_bytes,
        })
        .collect();

    Ok(ScanResult {
        image_count: image_infos.len(),
        total_size_bytes: total_size,
        images: image_infos,
    })
}

/// Henter eller genererer en thumbnail for et bilde
/// Returnerer stien til thumbnail-filen
#[tauri::command]
pub async fn get_thumbnail(path: String) -> Result<String, String> {
    let image_path = Path::new(&path);
    let cache_dir = get_thumbnail_cache_dir();
    
    let thumbnail_path = thumbnail::get_or_create_thumbnail(image_path, &cache_dir)
        .map_err(|e| e.to_string())?;
    
    Ok(thumbnail_path.to_string_lossy().to_string())
}

/// Åpner et bilde i standard bildeviser
#[tauri::command]
pub async fn open_image(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

/// Finner duplikater blant gitte bildestier ved hjelp av perceptuell hashing
/// Optimalisert for store bildesamlinger med parallell prosessering
#[tauri::command]
pub async fn find_duplicates(paths: Vec<String>, threshold: u32) -> Result<DuplicateResult, String> {
    let error_count = Mutex::new(0usize);
    
    // Beregn hasher parallelt for raskere prosessering
    let hashed_images: Vec<ImageWithHash> = paths
        .par_iter()
        .filter_map(|path_str| {
            let path = Path::new(path_str);
            
            match hashing::load_image(path) {
                Ok(img) => {
                    match hashing::compute_perceptual_hash(&img, hashing::HashType::Difference) {
                        Ok(hash) => {
                            let filename = path.file_name()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let size_bytes = std::fs::metadata(path)
                                .map(|m| m.len())
                                .unwrap_or(0);
                            
                            Some(ImageWithHash {
                                info: ImageInfo {
                                    path: path_str.clone(),
                                    filename,
                                    size_bytes,
                                },
                                hash: hash.to_base64(),
                            })
                        }
                        Err(_) => {
                            *error_count.lock().unwrap() += 1;
                            None
                        }
                    }
                }
                Err(_) => {
                    *error_count.lock().unwrap() += 1;
                    None
                }
            }
        })
        .collect();

    let processed = hashed_images.len();
    
    // Grupper bilder med lignende hasher
    let mut groups: HashMap<usize, Vec<ImageInfo>> = HashMap::new();
    let mut image_to_group: HashMap<usize, usize> = HashMap::new();
    let mut next_group_id = 0usize;

    for (i, img1) in hashed_images.iter().enumerate() {
        if image_to_group.contains_key(&i) {
            continue;
        }

        let mut group_members = vec![img1.info.clone()];
        let group_id = next_group_id;
        image_to_group.insert(i, group_id);

        for (j, img2) in hashed_images.iter().enumerate().skip(i + 1) {
            if image_to_group.contains_key(&j) {
                continue;
            }

            if let (Ok(h1), Ok(h2)) = (
                img_hash::ImageHash::<Box<[u8]>>::from_base64(&img1.hash),
                img_hash::ImageHash::<Box<[u8]>>::from_base64(&img2.hash)
            ) {
                if h1.dist(&h2) <= threshold {
                    group_members.push(img2.info.clone());
                    image_to_group.insert(j, group_id);
                }
            }
        }

        if group_members.len() > 1 {
            groups.insert(group_id, group_members);
        }
        next_group_id += 1;
    }

    let duplicate_groups: Vec<DuplicateGroup> = groups
        .into_values()
        .map(|images| DuplicateGroup { images })
        .collect();

    let total_duplicates: usize = duplicate_groups
        .iter()
        .map(|g| g.images.len() - 1)
        .sum();

    let errors = *error_count.lock().unwrap();

    Ok(DuplicateResult {
        groups: duplicate_groups,
        total_duplicates,
        processed: hashed_images.len(),
        errors,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortResult {
    pub processed: usize,
    pub success: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortOptions {
    pub use_day_folder: bool,
    pub use_month_names: bool,
}

/// Sorterer bilder basert på dato til en målsti (År/Måned)
#[tauri::command]
pub async fn sort_images_by_date(
    paths: Vec<String>,
    method: String, // "copy" eller "move"
    target_dir: String,
    options: Option<SortOptions>,
) -> Result<SortResult, String> {
    use crate::services::metadata;
    use chrono::Datelike;
    use std::fs;

    let target_path = Path::new(&target_dir);
    if !target_path.exists() {
        return Err(format!("Målmappen finnes ikke: {}", target_dir));
    }

    let opts = options.unwrap_or(SortOptions {
        use_day_folder: false,
        use_month_names: false,
    });
    
    let month_names = [
        "Januar", "Februar", "Mars", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Desember"
    ];

    let mut success_count = 0;
    let mut error_messages = Vec::new();

    for path_str in &paths {
        let source_path = Path::new(path_str);
        
        // Hopp over hvis filen ikke finnes
        if !source_path.exists() {
             error_messages.push(format!("Fil finnes ikke: {}", path_str));
             continue;
        }

        // Lese dato
        let date = match metadata::read_creation_date(source_path) {
            Some(d) => d,
            None => {
                error_messages.push(format!("Kunne ikke lese dato for: {}", path_str));
                continue;
            }
        };

        // Bygg målsti: target/YYYY/[MM - Navn]/[DD]/filnavn.ext
        let year = date.year();
        let month = date.month();
        let day = date.day();

        let month_folder = if opts.use_month_names {
            format!("{:02} - {}", month, month_names[(month - 1) as usize])
        } else {
            format!("{:02}", month)
        };

        let mut dest_dir = target_path.join(format!("{}", year)).join(month_folder);
        
        if opts.use_day_folder {
            dest_dir = dest_dir.join(format!("{:02}", day));
        }

        if let Err(e) = fs::create_dir_all(&dest_dir) {
             error_messages.push(format!("Kunne ikke opprette mappe {:?}: {}", dest_dir, e));
             continue;
        }

        let filename = source_path.file_name().unwrap_or_default();
        let mut dest_path = dest_dir.join(filename);

        // Håndter filnavn-kollisjoner (legg til _1, _2 osv)
        let mut counter = 1;
        let original_stem = source_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let extension = source_path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        while dest_path.exists() {
            // Hvis destinasjon er samme fil som kilde (allerede sortert?), hopp over
            if let Ok(src_canon) = fs::canonicalize(source_path) {
                if let Ok(dest_canon) = fs::canonicalize(&dest_path) {
                    if src_canon == dest_canon {
                        break;
                    }
                }
            }

            let new_filename = if extension.is_empty() {
                format!("{}_{}", original_stem, counter)
            } else {
                format!("{}_{}.{}", original_stem, counter, extension)
            };
            dest_path = dest_dir.join(new_filename);
            counter += 1;
        }

        // Utfør operasjon
        let result = if method == "move" {
            fs::rename(source_path, &dest_path)
        } else {
            fs::copy(source_path, &dest_path).map(|_| ())
        };

        match result {
            Ok(_) => success_count += 1,
            Err(e) => error_messages.push(format!("Feil ved {:?} av {:?}: {}", method, source_path, e)),
        }
    }

    Ok(SortResult {
        processed: paths.len(),
        success: success_count,
        errors: error_messages.len(),
        error_messages,
    })
}
