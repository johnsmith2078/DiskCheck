# Repository Guidelines

## Project Structure & Module Organization

- `src/`: React + TypeScript UI (entry: `src/main.tsx`, app shell: `src/App.tsx`)
- `src/components/`: feature/UI components (`Treemap.tsx`, `VirtualList.tsx`, `components/ui/*`)
- `src/lib/`: shared utilities + Tauri bindings (`fs.ts`, `format.ts`, `utils.ts`)
- `src/assets/`: static assets used by the UI
- `src-tauri/`: Rust backend + Tauri configuration
  - `src-tauri/src/`: Tauri commands (`lib.rs`) and filesystem scanner (`scanner.rs`)
  - `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`: app config and permissions
- Build outputs (`dist/`, `src-tauri/target/`) are generated and should not be committed.

## Build, Test, and Development Commands

```bash
npm install
npm run dev            # Vite dev server (web UI)
npm run tauri dev      # Run the desktop app (UI + Rust backend)
npm run build          # Typecheck (tsc) + Vite build to dist/
npm run preview        # Preview the production web build
npm run tauri build    # Build native bundles (requires Rust toolchain)
```

Rust-only (from `src-tauri/`): `cargo check`, `cargo fmt`, `cargo clippy`, `cargo test`.

## Coding Style & Naming Conventions

- TypeScript: `strict` is enabled; keep `tsc` clean (unused locals/params fail the build).
- Formatting: follow the existing style (2-space indentation, trailing commas). Use `PascalCase.tsx` for components and `camelCase` for functions/vars.
- Rust: follow `rustfmt` defaults; keep Tauri commands small and validate user-provided paths (they surface to the UI).

## Testing Guidelines

- No JS test runner is configured yet; treat `npm run build` and a `npm run tauri dev` smoke test as the baseline.
- When adding tests:
  - Rust: prefer unit tests near the code (`src-tauri/src/*`) or integration tests in `src-tauri/tests/`; run `cargo test`.

## Commit & Pull Request Guidelines

- Commit history uses short, description-only subjects (often Chinese), e.g. `优化响应速度`. Keep messages concise and action-oriented.
- PRs should include: what changed, how to test, and screenshots/GIFs for UI changes. Avoid committing generated artifacts (`dist/`, `src-tauri/target/`).

