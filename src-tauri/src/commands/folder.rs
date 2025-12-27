//! Kommandoer for mappehåndtering og duplikatdeteksjon

use crate::services::{hashing, scanner, thumbnail, sorter};
use crate::services::sorter::{OperationResult, SortConfig};
use crate::services::hashing::ComparableHash;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use crate::services::cache::HashCache;

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
pub async fn find_duplicates(app: tauri::AppHandle, paths: Vec<String>, threshold: u32) -> Result<DuplicateResult, String> {
    use tauri::Emitter; // Ensure Emitter trait is in scope
    let error_count = Mutex::new(0usize);
    
    // Last inn cache (trådsikker for parallell tilgang)
    let cache_dir = get_thumbnail_cache_dir(); // Vi gjenbruker denne mappen foreløpig
    let cache = Arc::new(RwLock::new(HashCache::new(&cache_dir)));
    
    // Beregn hasher parallelt for raskere prosessering
    let hashed_images: Vec<ImageWithHash> = paths
        .par_iter()
        .filter_map(|path_str| {
            let path = Path::new(path_str);
            
            // Hent metadata for mtime sjekk
            let metadata = match std::fs::metadata(path) {
                Ok(m) => m,
                Err(_) => {
                    *error_count.lock().unwrap() += 1;
                    return None;
                }
            };
            
            let mtime = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
            let size_bytes = metadata.len();
            let filename = path.file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            // 1. Sjekk cache (Read Lock)
            {
                let read_guard = cache.read().unwrap();
                if let Some(cached_hash_str) = read_guard.get(path_str, mtime) {
                    let _ = app.emit("progress", serde_json::json!({
                        "current": 1, // Rayon does not easily support global counter without mutex, simpler to just send "tick"
                        "total": 0 // Frontend knows total
                    }));
                    return Some(ImageWithHash {
                        info: ImageInfo {
                            path: path_str.clone(),
                            filename,
                            size_bytes,
                        },
                        hash: cached_hash_str,
                    });
                }
            } // Read lock droppes her

            // 2. Beregn hash hvis ikke i cache (Tung operasjon)
            match hashing::load_image(path) {
                Ok(img) => {
                    match hashing::compute_perceptual_hash(&img, hashing::HashType::Difference) {
                        Ok(hash) => {
                            let hash_str = hash.to_base64();
                            
                            // 3. Oppdater cache (Write Lock)
                            {
                                let mut write_guard = cache.write().unwrap();
                                write_guard.insert(path_str.clone(), mtime, hash_str.clone());
                            }

                            let _ = app.emit("progress", serde_json::json!({ "tick": true }));

                            Some(ImageWithHash {
                                info: ImageInfo {
                                    path: path_str.clone(),
                                    filename,
                                    size_bytes,
                                },
                                hash: hash_str,
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

    // Lagre cache til disk etter operasjon
    if let Ok(read_guard) = cache.read() {
        if let Err(e) = read_guard.save() {
            eprintln!("Kunne ikke lagre hash cache: {}", e);
        }
    }

    let processed = hashed_images.len();
    
    // Bygg BK-Tree for raskt søk (O(N log N) vs O(N^2))
    let mut tree: bk_tree::BKTree<ComparableHash, hashing::PerceptualMetric> = bk_tree::BKTree::new(hashing::PerceptualMetric);
    let mut hash_to_indices: HashMap<ComparableHash, Vec<usize>> = HashMap::new();

    // 1. Bygg treet og indeksering
    for (idx, img) in hashed_images.iter().enumerate() {
        if let Ok(hash) = img_hash::ImageHash::<Box<[u8]>>::from_base64(&img.hash) {
             let comp_hash = ComparableHash(hash);
             tree.add(comp_hash.clone());
             hash_to_indices.entry(comp_hash).or_default().push(idx);
        }
    }

    // 2. Finn grupper
    let mut groups: Vec<Vec<ImageInfo>> = Vec::new();
    let mut visited: std::collections::HashSet<usize> = std::collections::HashSet::new();

    for (i, img) in hashed_images.iter().enumerate() {
        if visited.contains(&i) {
            continue;
        }

        if let Ok(hash) = img_hash::ImageHash::<Box<[u8]>>::from_base64(&img.hash) {
            let comp_hash = ComparableHash(hash);
            
            // Finn alle hasher innenfor terskelverdien
            let matches = tree.find(&comp_hash, threshold);
            
            let mut group_members: Vec<ImageInfo> = Vec::new();
            
            for (_dist, found_hash) in matches {
                if let Some(indices) = hash_to_indices.get(found_hash) {
                    for &idx in indices {
                        if !visited.contains(&idx) {
                            visited.insert(idx);
                            group_members.push(hashed_images[idx].info.clone());
                        }
                    }
                }
            }

            if group_members.len() > 1 {
                groups.push(group_members);
            }
        }
    }

    let duplicate_groups: Vec<DuplicateGroup> = groups
        .into_iter()
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
        processed,
        errors,
    })
}



/// Sorterer bilder basert på dato til en målsti (År/Måned)
#[tauri::command]
pub async fn sort_images_by_date(
    paths: Vec<String>,
    method: String, // "copy" eller "move"
    target_dir: String,
    options: Option<SortConfig>,
) -> Result<OperationResult, String> {
    
    let config = options.unwrap_or(SortConfig {
        use_day_folder: false,
        use_month_names: false,
    });

    let result = sorter::sort_images(paths, &target_dir, &method, config);
    Ok(result)
}

/// Sletter bilder (flytter til papirkurv hvis mulig)
#[tauri::command]
pub async fn delete_images(paths: Vec<String>) -> Result<OperationResult, String> {
    let result = sorter::delete_images(paths);
    Ok(result)
}

/// Flytter bilder til valgt mappe (uten datosortering)
#[tauri::command]
pub async fn move_images(paths: Vec<String>, target_dir: String) -> Result<OperationResult, String> {
    let result = sorter::move_images(paths, &target_dir);
    Ok(result)
}
