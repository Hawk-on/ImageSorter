# ImageSorter

En desktop-applikasjon for å sortere bilder til mappestrukturer og finne duplikater ved hjelp av perceptuell hashing.

## Funksjoner

- 🖼️ **Bildesortering**: Organiser bilder i mappestrukturer basert på metadata, dato, eller manuell kategorisering
- 🔍 **Duplikatdeteksjon**: Finn duplikate og nesten-like bilder ved hjelp av:
  - Eksakt matching (fil-hash)
  - Perceptuell hashing (pHash, dHash, aHash)
  - Visuell likhetsammenligning
- ⚡ **Rask ytelse**: Rust-backend for effektiv bildebehandling
- 🎨 **Moderne UI**: Responsivt brukergrensesnitt bygget med webteknologi

## Teknologi

- **Frontend**: TypeScript, HTML, CSS
- **Backend**: Rust (via Tauri)
- **Framework**: Tauri v2
- **Bildebehandling**: image-rs, img_hash

## Utvikling

### Forutsetninger

- Rust (via rustup)
- Node.js 18+
- System dependencies (se `/setup` workflow)

### Kom i gang

```bash
# Installer dependencies
npm install

# Start utviklingsserver
npm run tauri dev

# Bygg for produksjon
npm run tauri build
```

## Prosjektstruktur

```
ImageSorter/
├── src/                    # Frontend kildekode
│   ├── components/         # UI komponenter
│   ├── services/           # Frontend tjenester
│   ├── styles/             # CSS stiler
│   └── main.ts             # Hovedinngang
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri kommandoer
│   │   ├── services/       # Backend tjenester
│   │   │   ├── hashing.rs  # Bildehashing
│   │   │   ├── scanner.rs  # Filskanning
│   │   │   └── sorter.rs   # Bildesortering
│   │   └── main.rs         # Rust hovedinngang
│   └── Cargo.toml          # Rust dependencies
├── .agent/                 # AI-assistent konfigurasjon
│   └── workflows/          # Arbeidsflytdefinisjoner
├── docs/                   # Dokumentasjon
└── package.json            # npm konfigurasjon
```

## Lisens

MIT
