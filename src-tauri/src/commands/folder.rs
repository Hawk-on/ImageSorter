//! Kommandoer for mappehåndtering

use crate::services::scanner;
use serde::Serialize;

#[derive(Serialize)]
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
