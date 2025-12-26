# ImageSorter - Arkitekturdokumentasjon

## Oversikt

ImageSorter er en desktop-applikasjon bygget med Tauri v2 som kombinerer en TypeScript/HTML frontend med en Rust backend for effektiv bildebehandling.

## Arkitekturdiagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop Application                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Frontend (WebView)                  │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │    │
│  │  │  Components │ │   Services  │ │    State    │    │    │
│  │  │  - Gallery  │ │  - Tauri    │ │  - Images   │    │    │
│  │  │  - Sidebar  │ │    Bridge   │ │  - Folders  │    │    │
│  │  │  - Compare  │ │  - Events   │ │  - Settings │    │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │ IPC                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 Backend (Rust/Tauri)                  │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │    │
│  │  │  Commands   │ │  Services   │ │    Utils    │    │    │
│  │  │ - scan_dir  │ │ - Hashing   │ │  - Image    │    │    │
│  │  │ - find_dups │ │ - Scanner   │ │    decode   │    │    │
│  │  │ - move_file │ │ - Sorter    │ │  - Thumb    │    │    │
│  │  └─────────────┘ └─────────────┘ └─────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Filsystemet     │
                    │ - Bilder          │
                    │ - Mapper          │
                    │ - Cache           │
                    └───────────────────┘
```

## Hovedkomponenter

### Frontend

| Komponent | Ansvar |
|-----------|--------|
| **Gallery** | Viser bilder i grid/liste med thumbnails |
| **Sidebar** | Mappenavigasjon og filtrering |
| **Compare** | Side-by-side sammenligning av duplikater |
| **Settings** | Brukerkonfigurasjon |

### Backend (Rust)

| Service | Ansvar |
|---------|--------|
| **Scanner** | Traverserer mapper og finner bildefiler |
| **Hashing** | Beregner perceptuelle og fil-hasher |
| **Sorter** | Flytter/kopierer filer til målmapper |
| **Cache** | Lagrer tidligere beregnede hasher |

## Duplikatdeteksjon

### Algoritmer

1. **Fil-hash (MD5/SHA-256)**
   - Rask første-pass
   - Finner kun eksakte duplikater

2. **Perceptuell Hashing**
   - **aHash (Average Hash)**: Enkel, rask, følsom for fargeendringer
   - **dHash (Difference Hash)**: Bedre for rotasjon/skalering
   - **pHash (Perceptual Hash)**: Mest robust, tregere

3. **Hamming Distance**
   - Sammenligner perceptuelle hasher
   - Terskelverdi bestemmer "likhet"

### Arbeidsflyt

```
Skann mappe → Beregn hasher → Sammenlign → Grupper duplikater → Vis resultat
     │              │              │              │                │
     ▼              ▼              ▼              ▼                ▼
  Parallell    Cache hasher   Hamming dist   Klynge-algo      Bruker-UI
  traversering  for gjenbruk   beregning     for gruppering
```

## Datamodeller

### Rust Types

```rust
struct ImageFile {
    path: PathBuf,
    file_hash: Option<String>,
    perceptual_hash: Option<Vec<u8>>,
    metadata: ImageMetadata,
}

struct ImageMetadata {
    size_bytes: u64,
    dimensions: (u32, u32),
    format: ImageFormat,
    created_at: Option<DateTime<Utc>>,
    exif: Option<ExifData>,
}

struct DuplicateGroup {
    primary: ImageFile,
    duplicates: Vec<ImageFile>,
    similarity: f32,
}
```

### Frontend Types

```typescript
interface ImageFile {
    path: string;
    thumbnail: string;
    metadata: ImageMetadata;
}

interface DuplicateGroup {
    primary: ImageFile;
    duplicates: ImageFile[];
    similarity: number;
}
```

## Ytelsesoptimalisering

1. **Parallell prosessering**: Bruk Rayon for CPU-bundet arbeid
2. **Thumbnail caching**: Forhåndsgenererte thumbnails
3. **Hash caching**: Lagre beregnede hasher i SQLite
4. **Lazy loading**: Last inn bilder etter behov i UI
5. **Web Workers**: Offload tunge operasjoner fra hovedtråd
