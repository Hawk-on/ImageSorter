# Utviklingsguide

## Kodekonvensjoner

### TypeScript/JavaScript

- Bruk TypeScript for all frontend-kode
- ESLint + Prettier for formatering
- Functional components der mulig
- Async/await fremfor callbacks

```typescript
// ✅ God praksis
async function loadImages(directory: string): Promise<ImageFile[]> {
    const result = await invoke<ImageFile[]>('scan_directory', { directory });
    return result;
}

// ❌ Unngå
function loadImages(directory, callback) {
    invoke('scan_directory', { directory }).then(callback);
}
```

### Rust

- Følg Rust idiomer og clippy-anbefalinger
- Bruk `Result<T, E>` for feilhåndtering
- Dokumenter public API med doc comments

```rust
/// Beregner perceptuell hash for et bilde.
/// 
/// # Arguments
/// * `path` - Sti til bildefilen
/// 
/// # Returns
/// En 64-byte hash som representerer bildet
pub fn calculate_phash(path: &Path) -> Result<Vec<u8>, HashError> {
    // ...
}
```

## Filnavnkonvensjoner

| Type | Konvensjon | Eksempel |
|------|------------|----------|
| TypeScript filer | camelCase | `imageService.ts` |
| Rust filer | snake_case | `image_service.rs` |
| Komponenter | PascalCase | `ImageGallery.ts` |
| CSS | kebab-case | `image-gallery.css` |

## Commit-meldinger

Følg Conventional Commits:

```
feat: legg til duplikatdeteksjon
fix: rett feil i hashberegning
docs: oppdater API-dokumentasjon
refactor: omstrukturer scanner-modul
test: legg til tester for hashing
```

## Testing

### Frontend

```bash
npm test                 # Kjør alle tester
npm run test:watch       # Watch mode
npm run test:coverage    # Med dekning
```

### Backend (Rust)

```bash
cd src-tauri
cargo test               # Kjør alle tester
cargo test -- --nocapture # Med output
```

## Debugging

### Frontend
- Bruk browser DevTools (høyreklikk → Inspect i dev mode)
- `console.log` for rask debugging
- Tauri DevTools for IPC-inspeksjon

### Backend
- Bruk `tracing` crate for logging
- `RUST_LOG=debug npm run tauri dev` for verbose logging
- rust-analyzer i editor for type hints
