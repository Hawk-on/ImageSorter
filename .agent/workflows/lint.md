---
description: Run linting and formatting checks
---

# Linting and Formatting

Run linting and formatting for the codebase.

## Frontend Linting

// turbo
1. Run ESLint on frontend code:
```bash
npm run lint
```

// turbo
2. Format frontend code with Prettier:
```bash
npm run format
```

## Rust Linting

// turbo
3. Run Clippy on Rust code:
```bash
cd src-tauri && cargo clippy
```

// turbo
4. Format Rust code:
```bash
cd src-tauri && cargo fmt
```
