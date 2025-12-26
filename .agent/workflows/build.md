---
description: Build the Tauri application for production
---

# Production Build

Build the Tauri application for production distribution.

## Steps

// turbo
1. Build the production bundle:
```bash
npm run tauri build
```

This will:
- Build the frontend with Vite in production mode
- Compile the Rust backend in release mode
- Create distributable bundles in `src-tauri/target/release/bundle/`

## Output Locations

- **Linux**: `.deb`, `.AppImage`, `.rpm` in `src-tauri/target/release/bundle/`
- **Windows**: `.msi`, `.exe` in `src-tauri/target/release/bundle/`
- **macOS**: `.app`, `.dmg` in `src-tauri/target/release/bundle/`
