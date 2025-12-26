---
description: Initial project setup and dependency installation
---

# Project Setup

Set up the development environment for ImageSorter.

## Prerequisites

1. **Rust**: Install via rustup
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

2. **Node.js**: Version 18+ required

3. **System dependencies (Linux)**:
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Installation Steps

// turbo
1. Install npm dependencies:
```bash
npm install
```

// turbo
2. Verify Tauri CLI is available:
```bash
npm run tauri --version
```

// turbo
3. Check Rust toolchain:
```bash
rustc --version && cargo --version
```

## Verify Setup

// turbo
4. Run a development build to verify everything works:
```bash
npm run tauri dev
```
