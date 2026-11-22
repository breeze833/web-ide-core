# AGENTS.md: Developer & AI Agent Guidelines for `web-ide-core`

This document defines the scope, architectural invariants, restrictions, and mandatory 4-phase development workflow for AI agents and contributors working on `web-ide-core`.

---

## 1. Role & Operating Principles & Architectural Boundaries

`web-ide-core` is a **backend-agnostic browser IDE workbench library** (`.`, `./editor`, `./terminal`, `./ui`, `./layout`, `./workspace`, `./style.css`) paired with an **optional** `./wasi` execution/worker adapter subpath.

### Core Rules
1. **Strict Specification Alignment**: `SPEC.md` is the authoritative ground truth. Update `SPEC.md` first before making structural or public API changes.
2. **Backend-Agnostic Core Boundary**:
   - Subpaths `.`, `./editor`, `./editor/*`, `./terminal`, `./terminal/*`, `./ui`, `./ui/*`, `./layout`, `./workspace`, `./workspace/*`, and `./style.css` **MUST NEVER** import Wasm/WASI packages (`wasi-host`, `vfs-wasi`, `busybox-wasi`, `stdin-wasi`, `canvas-wasi`, `ansi-line-editor`, `clang-wasi`, `raylib-wasi`, `make-wasi`, `sqlite-wasi`).
   - Core modules must communicate with workspaces strictly through the duck-typed VFS contract (`exists`, `readFile`, `writeFile`, `mkdir`, `remove`, `readDir`, `getAllFiles`, `subscribe`).
3. **Domain Neutrality in `./wasi`**:
   - Subpath `./wasi*` must depend only on generic WASI runtime primitives declared as optional `peerDependencies` (`wasi-host`, `vfs-wasi`, `busybox-wasi`, `stdin-wasi`, `canvas-wasi`, `ansi-line-editor`).
   - Do **not** couple domain-specific toolchains (`clang-wasi`, `raylib-wasi`, `make-wasi`, `sqlite-wasi`, `libturtle`) into `web-ide-core`. Expose explicit injection hooks (`resolveCustomImports`, `audioReceiver`, `toolchainCommands`, `extraBuiltins`, `onCommandDispatch`) instead.
4. **No Hardcoded Consumer State**:
   - Never hardcode consumer-specific globals (`window.__ideApp`), `localStorage` keys, IndexedDB names, seed source files, error notice prefixes, or toolchain command names in library defaults.
5. **Preserve Documentation & Test Coverage**:
   - Keep `test/wasi-adapters.test.js`'s core boundary check passing alongside unit tests across every module (`npm test` must exit `0`).
   - GitHub Actions release publishing triggers **only** on `v*` tag pushes (`make_latest: "true"` for `v*`, rolling `latest` tag with `make_latest: "false"`).

---

## 2. Mandatory 4-Phase Development Workflow

All agent-assisted changes in `web-ide-core` **must** strictly follow this 4-phase lifecycle. Skipping phases, implementing before `SPEC.md` confirmation, or committing without explicit instruction is prohibited.

```
┌──────────────────────────────────────────────────────────────┐
│  Phase 1: Confirm SPEC.md Revision                           │
│  - Draft or update SPEC.md with design & API rationale       │
│  - Present changes and wait for explicit user confirmation   │
└──────────────────────────────┬───────────────────────────────┘
                               │ Confirmed
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 2: Develop & Auto-Testing                             │
│  - Implement code strictly matching the confirmed SPEC.md    │
│  - Write/update automated tests and verify `npm test` passes │
└──────────────────────────────┬───────────────────────────────┘
                               │ Auto-tests pass
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 3: Manual Verification / Testing                      │
│  - Pause and ask the developer to run manual verification    │
│  - Provide exact commands / test cases (`npm pack`, etc.)    │
└──────────────────────────────┬───────────────────────────────┘
                               │ Developer confirms
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 4: Align Documents & Commit                           │
│  - Wait for explicit developer instruction to finalize       │
│  - Align README.md, AGENTS.md, SPEC.md, and package metadata │
│  - Stage and commit changes to git                           │
└──────────────────────────────────────────────────────────────┘
```

### Phase Rules & Restrictions

1. **Phase 1 — Confirm `SPEC.md` Revision**:
   - Before writing or modifying any `src/` or `test/` code for a new feature, refactor, or bug fix, update `SPEC.md` first (or present the proposed `SPEC.md` revision).
   - **Stop and wait** for the developer's explicit approval before starting Phase 2.
2. **Phase 2 — Develop & Auto-Testing**:
   - Implement only what was confirmed in `SPEC.md`.
   - Maintain high code quality: no duplicated logic, shallow nesting, small single-purpose helpers, and clear docstrings.
   - Add or update automated tests under `test/` covering normal paths, boundary guards, and error cases.
   - Run `npm test` after the final edit and verify all tests pass with zero skipped or relaxed assertions.
3. **Phase 3 — Manual Verification / Testing**:
   - Do **not** declare the task finished immediately after `npm test` passes.
   - Present the automated test results and prompt the developer to perform manual verification (e.g., testing downstream integration in `wasm-c-ide`, inspecting `npm pack --dry-run`), listing concrete checks.
   - **Stop and wait** for the developer to confirm manual testing results.
4. **Phase 4 — Align Documents & Commit**:
   - Do **not** unilaterally rewrite `README.md`, `AGENTS.md`, or run `git commit` / `git tag` / `git push` without explicit developer instruction.
   - Once instructed, align `README.md`, `AGENTS.md`, `SPEC.md`, and `package.json` with the verified implementation, re-run verification checks, and commit cleanly.

---

## 3. Development & Testing Commands

```bash
# Install dependencies (including WASI test devDependencies)
npm install --no-audit --no-fund

# Run automated test suite
npm test

# Pack release tarball into dist/
npm run pack:tgz

# Verify release tarball contents
npm pack --dry-run
```
