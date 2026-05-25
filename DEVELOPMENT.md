# simplelanguages.com — Development Summary

## Overview
A lightweight programming language executor website. Terminal-like dark interface, mobile-first, with plugin system. 11 languages, web mode (CodePen-like), themes, shareable URLs.

## Live URLs

| Service | URL |
|---|---|
| Frontend (GitHub Pages) | https://rodancz.github.io/simplelanguages/ |
| Backend API (Render) | https://simplelanguages-backend.onrender.com |
| GitHub Repo | https://github.com/rodancz/simplelanguages |

Render free tier sleeps after 15min inactivity — first wake takes ~30s. No action needed; the frontend calls /api/languages on load, which auto-wakes the backend. Just visit the site and wait.

## Project Structure

```
/home/rodan/simplelanguages/
├── backend/              # Rust/Axum API server
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs       # Server entry, routes, PORT env var for Render
│       ├── models.rs     # ExecuteRequest / ExecuteResponse
│       ├── language.rs   # 11 language configs (compile+run commands)
│       └── executor.rs   # Temp dirs, process spawning, 30s timeout
├── frontend/             # Vanilla JS SPA (served by GitHub Pages)
│   ├── index.html        # SPA entry with all UI elements
│   ├── package.json      # CodeMirror deps + esbuild
│   ├── build.js          # esbuild bundler
│   ├── vercel.json       # Vercel config (not used, billing issue)
│   ├── css/style.css     # Dark theme, themes, mobile, all styles
│   ├── js/
│   │   ├── app.js        # Source: full app logic
│   │   └── bundle.js     # Built bundle (esbuild output)
│   ├── manifest.json     # PWA manifest
│   └── sw.js             # Service worker
├── mcp-server/           # MCP server for OpenCode AI integration
│   ├── package.json
│   └── server.mjs        # Zero-dependency JSON-RPC over stdio
├── Dockerfile            # Docker image with all 7 toolchains
├── render.yaml           # Render blueprint (auto-deploys on push)
└── .gitignore
```

## Languages (Backend)

All 11 languages confirmed working via Render API:

| ID | Name | Version | Compile | Notes |
|---|---|---|---|---|
| python | Python | 3.13.12 | No | |
| javascript | JavaScript | Node 22.22.2 | No | |
| typescript | TypeScript | 6.0.3 | tsc | |
| java | Java | OpenJDK 21 | javac | |
| c | C | GCC 15.2.1 | gcc | |
| cpp | C++ | G++ 15.2.1 | g++ | |
| csharp | C# | .NET 10.0.300 | dotnet run | |
| rust | Rust | 1.93.1 | rustc | |
| lua | Lua | 5.4.8 | No | |
| html | HTML | Live | cat (echo) | category: web |
| css | CSS | Live | cat (echo) | category: web |

**API endpoints:**
- `GET /api/languages` — list all languages with templates
- `POST /api/execute` — `{ language, code, stdin? }` → `{ stdout, stderr, exit_code, wall_time_ms, timed_out }`
- `GET /api/health` — health check for Render

## Frontend Features (all implemented)

**Editor:**
- CodeMirror 6 locally bundled (esbuild) — no CDN dependency
- Language selector with 4 optgroups: ★ Favorites / Web / Languages / Plugins
- Find & Replace (Ctrl+F, via CodeMirror search panel)
- Zen/Focus mode (Ctrl+F again hides chrome, ESC to exit)
- Word wrap toggle in Settings
- Font size (10-24px) in Settings
- Indent: 2/4/8 spaces or tabs in Settings
- Tab key inserts indent with Tab

**Web Mode (CodePen-like):**
- Selecting HTML/CSS/JS auto-enters web mode
- 3 tabbed editors (HTML, CSS, JS) + live iframe preview
- "+" button to add more files
- Installing Babel plugin transpiles JS with @babel/standalone
- Preprocessor badge in status bar

**Output:**
- Stdin input panel (Ctrl+, to focus)
- Clear output button
- Copy output to clipboard button
- Execution time visible in output toolbar

**Plugins panel:**
- Search/filter input
- Install / Enable-Disable / Remove buttons
- Version badges on installed plugins
- Plugin entries: Go, Ruby, PHP, Swift, Kotlin, Haskell, Lua, Zig (languages) + OpenAI MCP, Claude MCP, OpenCode MCP (AI) + Babel, WASM Runtime (engines) + Terminal Green, Amber, Solar Flare (themes)
- Themes apply instantly to entire page via CSS variables

**UX:**
- Auto-save indicator (green dot flashes)
- Favorite languages (★ button, pinned to selector optgroup)
- Status bar: Ln/Col, language, indent, preprocessor
- Shareable URL (Ctrl+Shift+S) encodes code+lang in URL hash as base64 JSON
- Shortcut help (? key overlay)
- Ctrl+Enter to run
- Ctrl+Shift+L to focus language selector

**Mobile:**
- Floating run button (bottom-right)
- Keyboard bar (long-press editor shows Tab, brackets, quotes, etc.)
- Responsive layout (768px breakpoint)

## MCP Server (OpenCode Integration)

File: `/home/rodan/simplelanguages/mcp-server/server.mjs`
- Zero dependencies, JSON-RPC over stdio
- Tools: `list_languages`, `execute_code`
- Talks to the simplelanguages API at localhost:3000
- Configured in `~/.config/opencode/opencode.jsonc`

## Deployment

**Frontend:** GitHub Pages from `gh-pages` branch.
To update:
```bash
cd frontend && npm install && node build.js
# Clone gh-pages, copy files, push:
rm -rf /tmp/sl-deploy && git clone --branch gh-pages https://github.com/rodancz/simplelanguages.git /tmp/sl-deploy
cp index.html manifest.json sw.js /tmp/sl-deploy/
rm -rf /tmp/sl-deploy/css /tmp/sl-deploy/js
cp -r css js /tmp/sl-deploy/
cd /tmp/sl-deploy && git add -A && git commit -m "Update frontend" && git push origin gh-pages
```

**CRITICAL: All asset paths must be RELATIVE** (e.g. `css/style.css`, not `/css/style.css`).
GitHub Pages serves from `/simplelanguages/` so absolute paths 404. The backend also serves
the frontend via `ServeDir` fallback at root `/` — relative paths work for both.

**Backend:** Render auto-deploys from `main` branch on push.
Dockerfile installs: python3, nodejs+npm+tsc, default-jdk, gcc+g++, dotnet, rustc, lua5.4.
Backend binary name: `simplelanguages`, listens on `$PORT` (default 3000).

## Local Development

```bash
# Start backend
export PATH="$HOME/.dotnet:$PATH"
cargo build --release --manifest-path backend/Cargo.toml
./backend/target/release/simplelanguages
# → http://localhost:3000

# Rebuild frontend
cd frontend && npm install && node build.js

# MCP server (for OpenCode)
node mcp-server/server.mjs
```

## Key Architectural Decisions

- Rust/Axum backend chosen over original Python plan for speed/lightweight
- Backend serves the frontend as static files via `ServeDir` fallback (in addition to GitHub Pages)
- Frontend uses vanilla JS + CodeMirror 6, no framework (lighter than React)
- CodeMirror bundled via esbuild to avoid CDN dependency
- Backend uses local process execution (not Docker sandboxes) for simplicity — runs compilers directly in isolated temp dirs with 30s timeout
- API_BASE auto-detects localhost vs production to switch backend URL
- No database — everything is ephemeral, code persists in localStorage only
