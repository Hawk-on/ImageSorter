---
description: Run tests for the application
---

# Running Tests

Run tests for both frontend and Rust backend.

## Frontend Tests

// turbo
1. Run frontend unit tests:
```bash
npm test
```

## Backend Tests (Rust)

// turbo
2. Run Rust tests:
```bash
cd src-tauri && cargo test
```

## All Tests

// turbo
3. Run all tests:
```bash
npm test && cd src-tauri && cargo test
```
