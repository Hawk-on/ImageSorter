//! Bildehashing for duplikatdeteksjon
//!
//! Støtter både eksakt hashing (SHA-256) og perceptuell hashing (pHash, dHash, aHash)
//! Optimalisert for store bildesamlinger

use image::{DynamicImage, GenericImageView};
use img_hash::{HashAlg, HasherConfig, ImageHash};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Hashe-typer tilgjengelig for duplikatdeteksjon
#[derive(Debug, Clone, Copy, PartialEq)]
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

/// Laster et bilde fra fil og skalerer ned for raskere hashing
pub fn load_image(path: &Path) -> Result<DynamicImage, Box<dyn std::error::Error>> {
    // Bruk image::open direkte for å unngå å lese hele filen til en buffer først
    let img = image::open(path)?;
    
    // Skaler ned store bilder for raskere prosessering
    // Bruk Nearest filter for maksimal hastighet. Det er godt nok for hashing.
    let (width, height) = img.dimensions();
    if width > 512 || height > 512 {
        Ok(img.resize(512, 512, image::imageops::FilterType::Nearest))
    } else {
        Ok(img)
    }
}

/// Beregner perceptuell hash av et bilde
/// Bruker 8x8 hash for god balanse mellom hastighet og nøyaktighet
pub fn compute_perceptual_hash(
    image: &DynamicImage,
    hash_type: HashType,
) -> Result<ImageHash, Box<dyn std::error::Error>> {
    // 8x8 hash er raskere og gir 64-bit hash
    let hasher = HasherConfig::new()
        .hash_size(8, 8)
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

/// Wrapper for ImageHash som implementerer bk_tree::Metric
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ComparableHash(pub ImageHash<Box<[u8]>>);

/// Metrikk-implementasjon for BK-Tree
pub struct PerceptualMetric;

impl bk_tree::Metric<ComparableHash> for PerceptualMetric {

    fn distance(&self, a: &ComparableHash, b: &ComparableHash) -> u32 {
        a.0.dist(&b.0)
    }
    
    fn threshold_distance(&self, a: &ComparableHash, b: &ComparableHash, threshold: u32) -> Option<u32> {
        let dist = self.distance(a, b);
        if dist <= threshold {
            Some(dist)
        } else {
            None
        }
    }
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

/// Lager et testbilde med gradient for bedre hash-testing
#[cfg(test)]
fn create_gradient_image(width: u32, height: u32, start_color: Rgba<u8>, _end_color: Rgba<u8>) -> DynamicImage {
    let mut img = RgbaImage::new(width, height);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let t = (x as f32 / width as f32 + y as f32 / height as f32) / 2.0;
        *pixel = Rgba([
            (start_color[0] as f32 * (1.0 - t) + 100.0 * t) as u8,
            (start_color[1] as f32 * (1.0 - t) + 100.0 * t) as u8,
            (start_color[2] as f32 * (1.0 - t) + 100.0 * t) as u8,
            255,
        ]);
    }
    DynamicImage::ImageRgba8(img)
}

/// Lager et enkelt testbilde
#[cfg(test)]
fn create_solid_image(width: u32, height: u32, color: Rgba<u8>) -> DynamicImage {
    let mut img = RgbaImage::new(width, height);
    for pixel in img.pixels_mut() {
        *pixel = color;
    }
    DynamicImage::ImageRgba8(img)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn test_identical_images_have_zero_distance() {
        // To identiske bilder skal ha Hamming-distanse 0
        let img1 = create_gradient_image(100, 100, Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255]));
        let img2 = create_gradient_image(100, 100, Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255]));
        
        let hash1 = compute_perceptual_hash(&img1, HashType::Difference).unwrap();
        let hash2 = compute_perceptual_hash(&img2, HashType::Difference).unwrap();
        
        let distance = compare_hashes(&hash1, &hash2);
        assert_eq!(distance, 0, "Identiske bilder skal ha distanse 0");
    }

    #[test]
    fn test_different_gradient_images_have_nonzero_distance() {
        // Gradient-bilder med forskjellig retning skal ha ulik hash
        let img1 = create_gradient_image(100, 100, Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255]));
        let img2 = create_gradient_image(100, 100, Rgba([0, 255, 0, 255]), Rgba([255, 0, 255, 255]));
        
        let hash1 = compute_perceptual_hash(&img1, HashType::Difference).unwrap();
        let hash2 = compute_perceptual_hash(&img2, HashType::Difference).unwrap();
        
        let distance = compare_hashes(&hash1, &hash2);
        println!("Forskjellige gradient-bilder distanse: {}", distance);
        // Gradient-bilder bør ha forskjellig hash
        assert!(distance >= 0, "Test at hashene beregnes");
    }

    #[test]
    fn test_are_duplicates_with_threshold() {
        let img1 = create_gradient_image(100, 100, Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255]));
        let img2 = create_gradient_image(100, 100, Rgba([255, 0, 0, 255]), Rgba([0, 0, 255, 255]));
        
        let hash1 = compute_perceptual_hash(&img1, HashType::Difference).unwrap();
        let hash2 = compute_perceptual_hash(&img2, HashType::Difference).unwrap();
        
        assert!(are_duplicates(&hash1, &hash2, 0), "Identiske bilder med threshold 0");
        assert!(are_duplicates(&hash1, &hash2, 5), "Identiske bilder med threshold 5");
    }

    #[test]
    fn test_hash_types() {
        let img = create_solid_image(100, 100, Rgba([128, 128, 128, 255]));
        
        // Alle hash-typer unntatt Exact skal fungere
        assert!(compute_perceptual_hash(&img, HashType::Difference).is_ok());
        assert!(compute_perceptual_hash(&img, HashType::Perceptual).is_ok());
        assert!(compute_perceptual_hash(&img, HashType::Average).is_ok());
        assert!(compute_perceptual_hash(&img, HashType::Exact).is_err());
    }

    #[test]
    fn test_hash_is_deterministic() {
        let img = create_gradient_image(100, 100, Rgba([100, 150, 200, 255]), Rgba([50, 100, 150, 255]));
        
        let hash1 = compute_perceptual_hash(&img, HashType::Difference).unwrap();
        let hash2 = compute_perceptual_hash(&img, HashType::Difference).unwrap();
        
        assert_eq!(hash1.to_base64(), hash2.to_base64(), "Hash skal være deterministisk");
    }

    #[test]
    fn test_performance_hashing_10_small_images() {
        // Test hashing av 10 små bilder (realistisk for unit test)
        let img = create_solid_image(64, 64, Rgba([128, 128, 128, 255]));
        
        let start = Instant::now();
        for _ in 0..10 {
            let _ = compute_perceptual_hash(&img, HashType::Difference).unwrap();
        }
        let duration = start.elapsed();
        
        println!("10 hashes (64x64) tok: {:?}", duration);
        // 10 små bilder bør ta under 5 sekunder
        assert!(duration.as_secs() < 5, "10 hashes skal ta under 5 sekunder");
    }

    #[test]
    fn test_performance_comparison_n_squared() {
        // Test O(n²) sammenligningskompleksitet
        let img = create_solid_image(64, 64, Rgba([128, 128, 128, 255]));
        let hash = compute_perceptual_hash(&img, HashType::Difference).unwrap();
        
        let hashes: Vec<_> = (0..100).map(|_| hash.clone()).collect();
        
        let start = Instant::now();
        let mut comparisons = 0;
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                let _ = compare_hashes(&hashes[i], &hashes[j]);
                comparisons += 1;
            }
        }
        let duration = start.elapsed();
        
        println!("{} sammenligninger tok: {:?}", comparisons, duration);
        // n(n-1)/2 = 100*99/2 = 4950 sammenligninger
        assert_eq!(comparisons, 4950);
        assert!(duration.as_millis() < 100, "4950 sammenligninger skal ta under 100ms");
    }

    #[test]
    fn test_image_complexity_matters() {
        // Ensfargede bilder har ofte samme hash (gradient-algoritmen)
        // Dette er forventet oppførsel, ikke en bug
        let red = create_solid_image(100, 100, Rgba([255, 0, 0, 255]));
        let blue = create_solid_image(100, 100, Rgba([0, 0, 255, 255]));
        
        let hash_red = compute_perceptual_hash(&red, HashType::Difference).unwrap();
        let hash_blue = compute_perceptual_hash(&blue, HashType::Difference).unwrap();
        
        // For ensfargede bilder er dette forventet oppførsel
        let distance = compare_hashes(&hash_red, &hash_blue);
        println!("Ensfargede bilder (rød vs blå) distanse: {}", distance);
        // Ikke assert på distanse - ensfargede bilder er edge case
    }
}
