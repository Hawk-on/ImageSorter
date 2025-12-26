# CLAUDE.md - AI Assistant Context

Dette dokumentet gir kontekst for AI-assistenter som jobber med dette prosjektet.

## Prosjektoversikt

**ImageSorter** er en desktop-applikasjon for:
- Sortere bilder til mappestrukturer
- Finne duplikate bilder ved hjelp av perceptuell hashing

## Teknologistakk

| Komponent | Teknologi |
|-----------|-----------|
| Frontend | TypeScript, Vite, Vanilla CSS |
| Backend | Rust |
| Framework | Tauri v2 |
| Bildebehandling | image-rs, img_hash |

## Viktige Stier

```
src/                    # Frontend kildekode
src-tauri/              # Rust backend
src-tauri/src/commands/ # Tauri IPC commands
src-tauri/src/services/ # Backend business logic
docs/                   # Dokumentasjon
.agent/workflows/       # AI workflow definisjoner
```

## Workflows

Bruk disse slash-kommandoene for vanlige operasjoner:

| Kommando | Beskrivelse |
|----------|-------------|
| `/setup` | Installer dependencies |
| `/dev` | Start utviklingsserver |
| `/build` | Bygg for produksjon |
| `/test` | Kjør tester |
| `/lint` | Kjør linting |

## Kodekonvensjoner

### TypeScript
- Strenge typer, unngå `any`
- Async/await for asynkrone operasjoner
- Functional programming der mulig

### Rust
- Følg Clippy-anbefalinger
- Bruk `Result<T, E>` for feilhåndtering
- Dokumenter public API med `///` kommentarer

### CSS
- Bruk CSS custom properties for design tokens
- Mobile-first responsive design
- Mørkt tema som standard

## Backend Services

| Service | Fil | Ansvar |
|---------|-----|--------|
| Scanner | `scanner.rs` | Finn bildefiler i mapper |
| Hashing | `hashing.rs` | Beregn fil- og perceptuelle hasher |
| Duplicates | `duplicates.rs` | Grupper lignende bilder |
| Sorter | `sorter.rs` | Flytt/kopier filer |

## Tauri Commands

```rust
// Skann en mappe for bilder
#[tauri::command]
fn scan_directory(path: String) -> Result<Vec<ImageFile>, Error>

// Finn duplikater
#[tauri::command]
fn find_duplicates(paths: Vec<String>, threshold: f32) -> Result<Vec<DuplicateGroup>, Error>

// Flytt filer
#[tauri::command]
fn move_files(files: Vec<String>, destination: String) -> Result<(), Error>
```

## Feilsøking

### Frontend
- Åpne DevTools: høyreklikk → "Inspect" i dev mode
- Tauri IPC logging: sjekk konsollen

### Backend
- Verbose logging: `RUST_LOG=debug npm run tauri dev`
- Rust errors: sjekk terminalen der `tauri dev` kjører

## Vanlige Problemer

### "Failed to compile" Rust error
```bash
cd src-tauri && cargo check
```

### "Module not found" i frontend
```bash
npm install
```

### Tauri dev vil ikke starte
```bash
# Sjekk at alle system dependencies er installert
# Se /setup workflow
```
