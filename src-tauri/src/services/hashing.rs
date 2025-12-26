//! Bildehashing for duplikatdeteksjon
//!
//! Støtter både eksakt hashing (SHA-256) og perceptuell hashing (pHash, dHash, aHash)

use img_hash::image::DynamicImage;
use img_hash::{HashAlg, HasherConfig, ImageHash};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Hashe-typer tilgjengelig for duplikatdeteksjon
#[derive(Debug, Clone, Copy)]
pub enum HashType {
    /// Eksakt filhash (SHA-256)
    Exact,
    /// Perceptuell hash (pHash) - god for å finne visuelt like bilder
    Perceptual,
    /// Difference hash (dHash) - rask og effektiv
    Difference,
    /// Average hash (aHash) - enkel men mindre nøyaktig
    Average,
}

/// Resultat av en hashing-operasjon
#[derive(Debug, Clone)]
pub struct HashResult {
    pub hash: String,
    pub hash_type: String,
}

/// Beregner eksakt SHA-256 hash av en fil
pub fn compute_exact_hash(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let mut file = File::open(path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;

    let mut hasher = Sha256::new();
    hasher.update(&buffer);
    let result = hasher.finalize();

    Ok(hex::encode(result))
}

/// Laster et bilde fra fil for perceptuell hashing
pub fn load_image(path: &Path) -> Result<DynamicImage, Box<dyn std::error::Error>> {
    let img = img_hash::image::open(path)?;
    Ok(img)
}

/// Beregner perceptuell hash av et bilde
pub fn compute_perceptual_hash(
    image: &DynamicImage,
    hash_type: HashType,
) -> Result<ImageHash, Box<dyn std::error::Error>> {
    let hasher = HasherConfig::new()
        .hash_size(16, 16)
        .hash_alg(match hash_type {
            HashType::Perceptual => HashAlg::DoubleGradient,
            HashType::Difference => HashAlg::Gradient,
            HashType::Average => HashAlg::Mean,
            HashType::Exact => {
                return Err("Bruk compute_exact_hash for eksakt hashing".into());
            }
        })
        .to_hasher();

    Ok(hasher.hash_image(image))
}

/// Sammenligner to perceptuelle hasher og returnerer Hamming-distansen
pub fn compare_hashes(hash1: &ImageHash, hash2: &ImageHash) -> u32 {
    hash1.dist(hash2)
}

/// Bestemmer om to bilder er duplikater basert på Hamming-distanse
/// threshold: 0 = eksakt lik, høyere = mer toleranse for forskjeller
pub fn are_duplicates(hash1: &ImageHash, hash2: &ImageHash, threshold: u32) -> bool {
    compare_hashes(hash1, hash2) <= threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_type_variants() {
        let _ = HashType::Exact;
        let _ = HashType::Perceptual;
        let _ = HashType::Difference;
        let _ = HashType::Average;
    }
}
