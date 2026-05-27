import { EditorView, basicSetup } from "codemirror";
import { keymap, drawSelection } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, historyKeymap, history, indentWithTab } from "@codemirror/commands";
import { searchKeymap, search } from "@codemirror/search";

const SK_LANG = "sl_lang";
const SK_PREFIX = "sl_code_";
const SK_PLUGINS = "sl_plugins";
const SK_ENABLED = "sl_plugins_enabled";
const SK_THEME = "sl_theme";
const SK_SETTINGS = "sl_settings";
const SK_FAVS = "sl_favs";
const SK_FILES = "sl_files_";
const SK_ADMIN_KEY = "sl_admin_key";

const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "" : "https://simplelanguages-backend.onrender.com";

const BUILTIN_PLUGINS = [
    { id: "swift", name: "Swift", desc: "Swift compiler — coming soon.", cat: "language", ver: "6.x", tpl: 'print("Hello, Swift!")', upcoming: true },
    { id: "kotlin", name: "Kotlin", desc: "Kotlin JVM runtime — coming soon.", cat: "language", ver: "2.1.x", tpl: 'fun main() {\n    println("Hello, Kotlin!")\n}', upcoming: true },
    { id: "haskell", name: "Haskell", desc: "GHC Haskell — coming soon.", cat: "language", ver: "9.12.x", tpl: 'main :: IO ()\nmain = putStrLn "Hello, Haskell!"', upcoming: true },
    { id: "zig", name: "Zig", desc: "Zig compiler — coming soon.", cat: "language", ver: "0.14.x", tpl: 'const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello, Zig!\\n", .{});\n}', upcoming: true },
    { id: "plugin-creator", name: "Plugin Creator", desc: "Create and submit custom plugins. Currently metadata-only — full code editor coming soon.", cat: "engine", ver: "alpha", upcoming: true },
    { id: "openai-mcp", name: "OpenAI MCP", desc: "AI assistant powered by OpenAI models via MCP protocol.", cat: "ai", ver: "1.0.0" },
    { id: "claude-mcp", name: "Claude MCP", desc: "AI assistant powered by Anthropic Claude via MCP.", cat: "ai", ver: "1.0.0" },
    { id: "opencode-mcp", name: "OpenCode MCP", desc: "Connect OpenCode AI agent to execute and test code. This powers us right now.", cat: "ai", ver: "1.0.0" },
    { id: "babel", name: "Babel Engine", desc: "Transpile modern JS/TS with Babel, use JSX and ES2025+.", cat: "engine", ver: "7.27.x" },
    { id: "wasm-runt", name: "WASM Runtime", desc: "Execute WebAssembly modules directly in-browser.", cat: "engine", ver: "1.0.0" },
    { id: "green-term", name: "Terminal Green", desc: "Classic CRT green-on-black terminal theme.", cat: "theme", css: "green" },
    { id: "amber-term", name: "Amber Terminal", desc: "Warm amber-on-black retro terminal theme.", cat: "theme", css: "amber" },
    { id: "solar-flare", name: "Solar Flare", desc: "High-contrast warm theme with orange accents.", cat: "theme", css: "solar" },
];

let PLUGINS = [...BUILTIN_PLUGINS];

const WEB_LANGS = ["html", "css", "javascript"];

const langMods = {
    python: () => import("@codemirror/lang-python").then(m => m.python()),
    javascript: () => import("@codemirror/lang-javascript").then(m => m.javascript()),
    typescript: () => import("@codemirror/lang-javascript").then(m => m.typescript()),
    java: () => import("@codemirror/lang-java").then(m => m.java()),
    c: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    cpp: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    csharp: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    rust: () => import("@codemirror/lang-rust").then(m => m.rust()),
    html: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    css: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    go: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    swift: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    kotlin: () => import("@codemirror/lang-java").then(m => m.java()),
    haskell: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    lua: () => import("@codemirror/lang-python").then(m => m.python()),
    zig: () => import("@codemirror/lang-rust").then(m => m.rust()),
    ruby: () => import("@codemirror/lang-python").then(m => m.python()),
    php: () => import("@codemirror/lang-cpp").then(m => m.cpp()),
};

function $(s) { return document.querySelector(s); }

let langs = [];
let editors = [];
let activeFile = 0;
let files = [{ name: "main.py", code: "", lang: "python" }];
let outputEl, execTimeEl, saveDotEl, statusLang, statusCursor, statusIndent, statusPrep;
let langConf, fontSizeConf, tabSizeConf, wrapConf;

async function init() {
    outputEl = $("#output-content");
    execTimeEl = $("#exec-time");
    saveDotEl = $("#save-dot");
    statusLang = $("#status-lang");
    statusCursor = $("#status-cursor");
    statusIndent = $("#status-indent");
    statusPrep = $("#status-preprocessor");
    langConf = new Compartment();
    fontSizeConf = new Compartment();
    tabSizeConf = new Compartment();
    wrapConf = new Compartment();

    applySavedTheme();
    applySettings();
    await buildLangSelector();
    restoreCode();

    if (files.length > 1) buildTabs();

    const ext = await getLangExt(files[activeFile].lang);
    const editor = await createEditor(ext, files[activeFile].code);

    bindEvents();
    updateStatus();
    checkShareURL();
    fetchApprovedPlugins();
}

async function fetchApprovedPlugins() {
    try {
        const resp = await fetch(API_BASE + "/api/plugins");
        const data = await resp.json();
        if (data.plugins && data.plugins.length) {
            const userPlugins = data.plugins.map(p => ({
                id: p.id,
                name: p.name,
                desc: p.desc,
                cat: p.cat,
                ver: p.ver || "",
                tpl: p.tpl || "",
                css: p.css || "",
                upcoming: false,
                source_filename: p.source_filename,
                compile_cmd: p.compile_cmd,
                run_cmd: p.run_cmd,
            }));
            const builtinIds = new Set(BUILTIN_PLUGINS.map(p => p.id));
            const merged = [...BUILTIN_PLUGINS];
            userPlugins.forEach(p => {
                if (!builtinIds.has(p.id)) merged.push(p);
            });
            PLUGINS = merged;
            if ($("#plugin-panel").classList.contains("open")) renderPlugins();
            refreshLangSelector();
        }
    } catch {}
}

async function refreshLangSelector() {
    const cur = files[activeFile] ? files[activeFile].lang : "python";
    await buildLangSelector();
    $("#language-select").value = cur;
}

function restoreCode() {
    const urlCode = loadFromURL();
    if (urlCode) {
        if (urlCode.files) {
            files = urlCode.files;
            activeFile = 0;
            editors = [];
        } else {
            files = [{ name: getFileName(urlCode.lang), code: urlCode.code, lang: urlCode.lang }];
            activeFile = 0;
            editors = [];
        }
        return;
    }
    const storedFiles = getStored("files");
    if (storedFiles && storedFiles.length) {
        files = storedFiles;
        activeFile = 0;
        editors = [];
        return;
    }
    const savedLang = localStorage.getItem(SK_LANG) || "python";
    const code = localStorage.getItem(SK_PREFIX + savedLang) || getTemplate(savedLang);
    files = [{ name: getFileName(savedLang), code, lang: savedLang }];
    activeFile = 0;
    editors = [];
}

async function createEditor(langExt, code) {
    const settings = loadSettings();
    const e = new EditorView({
        doc: code,
        extensions: [
            basicSetup,
            history(),
            keymap.of(defaultKeymap),
            keymap.of(searchKeymap),
            keymap.of([{ key: "Tab", run: indentWithTab }]),
            search({ top: true }),
            drawSelection(),
            langConf.of(langExt),
            oneDark,
            fontSizeConf.of(EditorView.theme({ "&": { fontSize: settings.fontSize + "px" }, ".cm-scroller": { fontSize: settings.fontSize + "px" } })),
            tabSizeConf.of(EditorState.tabSize.of(settings.tabSize)),
            wrapConf.of(settings.wordWrap ? EditorView.lineWrapping : []),
            keymap.of([{ key: "Mod-f", run: toggleFind, preventDefault: true }]),
            EditorView.updateListener.of(upd => {
                if (upd.docChanged) { saveDocs(); updateWebPreview(); }
                if (upd.selectionSet) updateStatus();
            }),
        ],
        parent: document.getElementById("editor"),
    });
    editors.push(e);
    return e;
}

function toggleFind(view) {
    const zen = document.body.classList.toggle("zen");
    if (zen) {
        $("#topbar").classList.add("hidden");
        $("#output").classList.add("hidden");
        $("#statusbar").classList.add("hidden");
        $("#tabbar").classList.add("hidden");
        if ($("#web-preview")) $("#web-preview").classList.add("hidden");
        view.contentDOM.focus();
        return true;
    } else {
        $("#topbar").classList.remove("hidden");
        $("#output").classList.remove("hidden");
        $("#statusbar").classList.remove("hidden");
        if (files.length > 1) $("#tabbar").classList.remove("hidden");
        if (isWebMode()) $("#web-preview").classList.remove("hidden");
        const panel = view.dom.querySelector(".cm-search");
        if (panel) { panel.style.display = "block"; panel.querySelector("input").focus(); }
        return true;
    }
}

async function getLangExt(lang) {
    const fn = langMods[lang] || langMods["python"];
    return await fn();
}

function getFileName(lang) {
    const extMap = { python: "py", javascript: "js", typescript: "ts", java: "java", c: "c", cpp: "cpp", csharp: "cs", rust: "rs", lua: "lua", html: "html", css: "css", go: "go", ruby: "rb", php: "php", swift: "swift", kotlin: "kt", haskell: "hs", zig: "zig" };
    const ext = extMap[lang] || lang;
    return "main." + ext;
}

function getTemplate(lang) {
    const langObj = langs.find(l => l.id === lang);
    return langObj ? langObj.template : "// " + lang;
}

async function buildLangSelector() {
    let backLangs = [];
    try { const r = await fetch(API_BASE + "/api/languages"); backLangs = await r.json(); } catch {}
    const sel = $("#language-select");
    sel.innerHTML = "";
    const favs = getFavs();
    const enabled = getEnabled();
    const pluginIds = PLUGINS.filter(p => p.cat === "language" && enabled.includes(p.id) && !p.upcoming).map(p => p.id);
    const allIds = [...backLangs.map(l => l.id), ...pluginIds];

    langs = [...backLangs];
    pluginIds.forEach(pid => {
        if (!backLangs.find(bl => bl.id === pid)) {
            const p = PLUGINS.find(x => x.id === pid);
            if (p) langs.push({ id: pid, name: p.name + " *", version: p.ver || "plugin", extension: p.id, template: p.tpl || "", category: "plugin" });
        }
    });

    const webLangs = langs.filter(l => WEB_LANGS.includes(l.id));
    const favLangs = langs.filter(l => favs.includes(l.id));
    const baseLangs = langs.filter(l => !WEB_LANGS.includes(l.id) && l.category !== "plugin");
    const plugLangs = langs.filter(l => l.category === "plugin");

    if (favLangs.length) {
        const g = document.createElement("optgroup"); g.label = "★ Favorites";
        favLangs.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; g.appendChild(o); });
        sel.appendChild(g);
    }
    if (webLangs.length) {
        const g = document.createElement("optgroup"); g.label = "— Web —";
        webLangs.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; g.appendChild(o); });
        sel.appendChild(g);
    }
    if (baseLangs.length) {
        const g = document.createElement("optgroup"); g.label = "— Languages —";
        baseLangs.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; g.appendChild(o); });
        sel.appendChild(g);
    }
    if (plugLangs.length) {
        const g = document.createElement("optgroup"); g.label = "— Plugins —";
        plugLangs.forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; g.appendChild(o); });
        sel.appendChild(g);
    }

    $("#fav-btn").classList.toggle("active", favs.includes(files[activeFile].lang));
}

function getFavs() { try { return JSON.parse(localStorage.getItem(SK_FAVS)) || []; } catch { return []; } }
function setFavs(arr) { localStorage.setItem(SK_FAVS, JSON.stringify(arr)); }

function getStored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SK_SETTINGS)) || { fontSize: 14, tabSize: 4, wordWrap: false, keymap: "default" }; }
    catch { return { fontSize: 14, tabSize: 4, wordWrap: false, keymap: "default" }; }
}

function saveSettings(s) { localStorage.setItem(SK_SETTINGS, JSON.stringify(s)); }

function applySettings() {
    const s = loadSettings();
    const docs = $("#set-fontsize"); if (docs) docs.value = s.fontSize;
    const wrap = $("#set-wrap"); if (wrap) wrap.checked = s.wordWrap;
    const indent = $("#set-indent"); if (indent) indent.value = s.tabSize >= 8 ? "8" : s.tabSize === 2 ? "2" : s.tabSize === 1 ? "\t" : "4";
}

function isWebMode() { return files.every(f => WEB_LANGS.includes(f.lang)) && files.length >= 1; }

function buildTabs() {
    const bar = $("#tabbar");
    bar.classList.remove("hidden");
    bar.innerHTML = "";
    files.forEach((f, i) => {
        const tab = document.createElement("span");
        tab.className = "tab" + (i === activeFile ? " active" : "");
        tab.textContent = f.name;
        tab.addEventListener("click", () => switchTab(i));
        bar.appendChild(tab);
    });
    const addBtn = document.createElement("button");
    addBtn.className = "tab-add"; addBtn.textContent = "+"; addBtn.title = "Add file";
    addBtn.addEventListener("click", addFile);
    bar.appendChild(addBtn);
}

async function switchTab(i) {
    if (i === activeFile) return;
    saveCurFile();
    activeFile = i;
    const ext = await getLangExt(files[i].lang);
    editors[0].dispatch({ effects: langConf.reconfigure(ext) });
    editors[0].dispatch({ changes: { from: 0, to: editors[0].state.doc.length, insert: files[i].code } });
    buildTabs();
    updateWebPreview();
    updateStatus();
    $("#language-select").value = files[i].lang;
    $("#fav-btn").classList.toggle("active", getFavs().includes(files[i].lang));
}

function saveCurFile() {
    if (editors.length) {
        files[activeFile].code = editors[0].state.doc.toString();
    }
}

async function addFile() {
    saveCurFile();
    const name = prompt("File name:", "main.c");
    if (!name) return;
    const ext = name.split(".").pop();
    const langMap = { py: "python", js: "javascript", ts: "typescript", java: "java", c: "c", cpp: "cpp", cs: "csharp", rs: "rust", lua: "lua", html: "html", css: "css", rb: "ruby", go: "go", php: "php", zig: "zig", hs: "haskell", kt: "kotlin" };
    const lang = langMap[ext] || "plaintext";
    files.push({ name, code: getTemplate(lang), lang });
    activeFile = files.length - 1;
    editors[0].dispatch({ changes: { from: 0, to: editors[0].state.doc.length, insert: files[activeFile].code } });
    const langExt = await getLangExt(lang);
    editors[0].dispatch({ effects: langConf.reconfigure(langExt) });
    buildTabs();
    if (isWebMode()) enterWebMode(); else leaveWebMode();
}
async function switchFiles() {
    $("#language-select").dispatchEvent(new Event("change"));
}

function saveDocs() {
    files[activeFile].code = editors[0].state.doc.toString();
    localStorage.setItem(SK_PREFIX + files[activeFile].lang, files[activeFile].code);
    localStorage.setItem(SK_LANG, files[activeFile].lang);
    saveDotEl.classList.add("visible");
    clearTimeout(saveDotEl._t);
    saveDotEl._t = setTimeout(() => saveDotEl.classList.remove("visible"), 800);
}

function updateStatus() {
    if (!editors.length) return;
    const pos = editors[0].state.selection.main.head;
    const line = editors[0].state.doc.lineAt(pos);
    statusCursor.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
    statusLang.textContent = files[activeFile].lang;
    const s = loadSettings();
    statusIndent.textContent = s.tabSize >= 2 && s.tabSize < 8 ? `Spaces: ${s.tabSize}` : s.tabSize === 1 ? "Tabs" : "Spaces: " + s.tabSize;
    const webMode = isWebMode();
    if (webMode && getEnabled().includes("babel")) {
        statusPrep.textContent = "Babel | Live preview";
    } else if (webMode) {
        statusPrep.textContent = "Live preview";
    } else {
        statusPrep.textContent = "";
    }
    if (webMode) enterWebMode(); else leaveWebMode();
}

function enterWebMode() {
    const prev = $("#web-preview");
    if (prev && !prev.classList.contains("hidden")) return;
    let previewEl = $("#web-preview");
    if (!previewEl) {
        previewEl = document.createElement("div");
        previewEl.id = "web-preview";
        document.querySelector("main").appendChild(previewEl);
    }
    previewEl.classList.remove("hidden");
    if (!files.find(f => f.lang === "html")) {
        files.push({ name: "index.html", code: '<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>', lang: "html" });
    }
    if (!files.find(f => f.lang === "css")) {
        files.push({ name: "style.css", code: "body { background: #111; color: #fff; font-family: sans-serif; }", lang: "css" });
    }
    if (!files.find(f => f.lang === "javascript")) {
        files.push({ name: "script.js", code: "console.log('Hello from JS!');", lang: "javascript" });
    }
    buildTabs();
    updateWebPreview();
}

function leaveWebMode() {
    const prev = $("#web-preview");
    if (prev) prev.classList.add("hidden");
}

function updateWebPreview() {
    const prev = $("#web-preview");
    if (!prev || prev.classList.contains("hidden")) return;
    const htmlFile = files.find(f => f.lang === "html");
    const cssFile = files.find(f => f.lang === "css");
    const jsFile = files.find(f => f.lang === "javascript");
    const enabled = getEnabled();
    const useBabel = enabled.includes("babel");

    let html = htmlFile ? htmlFile.code : "";
    const css = cssFile ? cssFile.code : "";
    const js = jsFile ? jsFile.code : "";

    let finalHtml = html;
    if (css) {
        finalHtml = finalHtml.replace("</head>", `<style>${css}</style></head>`);
        if (!finalHtml.includes("<style>")) {
            finalHtml = finalHtml.replace("<head>", `<head><style>${css}</style>`);
        }
        if (!finalHtml.includes("<head>")) {
            finalHtml = `<head><style>${css}</style></head>` + finalHtml;
        }
    }
    let jsTag = js;
    if (useBabel && js) {
        jsTag = `<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
<script type="text/babel">${js}<\/script>`;
    } else if (js) {
        jsTag = `<script>${js}<\/script>`;
    }
    if (finalHtml.includes("</body>")) {
        finalHtml = finalHtml.replace("</body>", jsTag + "</body>");
    } else if (finalHtml.includes("<body>")) {
        finalHtml = finalHtml.replace("<body>", "<body>" + jsTag);
    } else {
        finalHtml += jsTag;
    }

    let iframe = prev.querySelector("iframe");
    if (!iframe) {
        iframe = document.createElement("iframe");
        prev.appendChild(iframe);
    }
    iframe.srcdoc = finalHtml;
}

async function switchLanguage() {
    const id = $("#language-select").value;
    const fn = langMods[id] || langMods["python"];
    if (!fn || !editors.length) return;
    const ext = await fn();
    editors[0].dispatch({ effects: langConf.reconfigure(ext) });
    files[activeFile].lang = id;
    files[activeFile].name = getFileName(id);
    let code = localStorage.getItem(SK_PREFIX + id);
    if (code == null) code = getTemplate(id);
    files[activeFile].code = code;
    editors[0].dispatch({ changes: { from: 0, to: editors[0].state.doc.length, insert: code } });
    localStorage.setItem(SK_LANG, id);
    buildTabs();
    updateStatus();
    $("#fav-btn").classList.toggle("active", getFavs().includes(id));
}

async function runCode() {
    if (!editors.length) return;
    saveCurFile();

    // Web mode: render entirely client-side, no backend needed
    if (isWebMode()) {
        $("#run-btn").classList.add("running");
        $("#run-btn").textContent = "...";
        updateWebPreview();
        execTimeEl.textContent = "client-side";
        outputEl.innerHTML = '<span class="meta-info">Preview rendered locally in browser — see preview panel</span>';
        $("#run-btn").classList.remove("running");
        $("#run-btn").textContent = "▶ Run";
        return;
    }

    const code = files[activeFile].code;
    const lang = files[activeFile].lang;

    $("#run-btn").classList.add("running");
    $("#run-btn").textContent = "...";
    outputEl.innerHTML = '<span class="meta-info">Running…</span>';

    try {
        const stdinVal = $("#stdin-input").value || "";
        const resp = await fetch(API_BASE + "/api/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang, code, stdin: stdinVal }),
        });
        const data = await resp.json();

        let html = "";
        if (data.compile_cmd) html += `<div class="cmd-info"><span class="cmd-label">$ compile</span> ${esc(data.compile_cmd.join(" "))}</div>`;
        if (data.run_cmd) html += `<div class="cmd-info"><span class="cmd-label">$ run</span> ${esc(data.run_cmd.join(" "))}</div>`;
        if (data.stdout) html += `<span class="stdout">${esc(data.stdout)}</span>`;
        if (data.stderr) html += `<span class="stderr">${esc(data.stderr)}</span>`;

        const timeClass = data.wall_time_ms > 500 ? "warn" : "accent";
        execTimeEl.innerHTML = data.timed_out
            ? `<span class="timed-out">Timed out</span> · ${data.wall_time_ms}ms · exit ${data.exit_code}`
            : `${data.wall_time_ms}ms · exit ${data.exit_code}`;

        html += `<div class="meta-info">`;
        if (data.timed_out) html += `<span class="timed-out">Timed out</span> · `;
        html += `${data.wall_time_ms}ms · exit ${data.exit_code}</div>`;

        outputEl.innerHTML = html || '<span class="meta-info">(no output)</span>';
    } catch (e) {
        outputEl.innerHTML = `<span class="stderr">Connection failed: ${esc(e.message)}</span>`;
        execTimeEl.textContent = "";
    } finally {
        $("#run-btn").classList.remove("running");
        $("#run-btn").textContent = "▶ Run";
    }
}

function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function bindEvents() {
    $("#language-select").addEventListener("change", switchLanguage);
    $("#run-btn").addEventListener("click", runCode);
    $("#mobile-run").addEventListener("click", runCode);
    $("#clear-output").addEventListener("click", () => { outputEl.innerHTML = ""; execTimeEl.textContent = ""; });
    $("#copy-output").addEventListener("click", () => {
        const text = outputEl.innerText || outputEl.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const t = $("#share-toast"); t.textContent = "Copied!"; t.classList.add("show");
            setTimeout(() => t.classList.remove("show"), 1500);
        });
    });

    document.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCode(); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "L") { e.preventDefault(); $("#language-select").focus(); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") { e.preventDefault(); shareURL(); }
        if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); focusStdin(); }
        if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA" && !document.querySelector(".cm-focused")) {
            e.preventDefault(); toggleHelp();
        }
        if (e.key === "Escape") {
            closeAllPanels();
        }
    });

    document.body.addEventListener("swiped-left", () => {
        if (window.innerWidth > 768) return;
        const prev = $("#web-preview");
        if (prev && !prev.classList.contains("hidden")) { prev.classList.add("hidden"); }
        // switch to output focus
    });

    // Settings
    $("#settings-btn").addEventListener("click", toggleSettings);
    $("#settings-close").addEventListener("click", toggleSettings);
    $("#set-wrap").addEventListener("change", () => updateSetting("wordWrap", $("#set-wrap").checked));
    $("#set-fontsize").addEventListener("input", () => updateSetting("fontSize", parseInt($("#set-fontsize").value)));
    $("#set-indent").addEventListener("change", () => {
        const v = $("#set-indent").value;
        updateSetting("tabSize", v === "\t" ? 1 : parseInt(v));
    });

    // Favorites
    $("#fav-btn").addEventListener("click", () => {
        const favs = getFavs();
        const lang = files[activeFile].lang;
        const idx = favs.indexOf(lang);
        if (idx >= 0) favs.splice(idx, 1); else favs.push(lang);
        setFavs(favs);
        $("#fav-btn").classList.toggle("active", favs.includes(lang));
        buildLangSelector();
    });

    // Mobile web preview close
    const wpc = $("#web-preview-close");
    if (wpc) wpc.addEventListener("click", () => {
        const prev = $("#web-preview");
        if (prev) prev.classList.add("hidden");
        leaveWebMode();
    });

    // Keyboard bar
    $("#keyboard-bar").querySelectorAll("button[data-key]").forEach(b => {
        b.addEventListener("click", () => {
            const key = b.dataset.key;
            const view = editors[0];
            if (!view) return;
            view.dispatch(view.state.replaceSelection(key));
            view.focus();
        });
    });
    document.querySelector(".kb-close").addEventListener("click", () => $("#keyboard-bar").classList.add("hidden"));

    // Help overlay
    $("#help-overlay").addEventListener("click", e => { if (e.target === $("#help-overlay")) toggleHelp(); });

    initPlugins();
    initCreatePlugin();
    initAdmin();
}

function focusStdin() {
    const p = $("#stdin-panel");
    p.classList.remove("hidden");
    $("#stdin-input").focus();
}

function toggleHelp() {
    const h = $("#help-overlay");
    h.classList.toggle("hidden");
}

function closeAllPanels() {
    if ($("#plugin-panel").classList.contains("open")) togglePluginPanel();
    if ($("#settings-panel").classList.contains("open")) toggleSettings();
    if (!$("#help-overlay").classList.contains("hidden")) toggleHelp();
    if ($("#stdin-panel").classList.contains("visible")) $("#stdin-panel").classList.add("hidden");
    if (!$("#admin-overlay").classList.contains("hidden")) $("#admin-overlay").classList.add("hidden");
    if (!$("#plugin-create-overlay").classList.contains("hidden")) $("#plugin-create-overlay").classList.add("hidden");
}

function toggleSettings() {
    const p = $("#settings-panel");
    const open = p.classList.contains("open");
    if (open) {
        p.classList.remove("open"); p.classList.add("closed"); $("#settings-btn").classList.remove("active");
    } else {
        if ($("#plugin-panel").classList.contains("open")) togglePluginPanel();
        p.classList.remove("closed"); p.classList.add("open"); $("#settings-btn").classList.add("active");
        applySettings();
    }
}

function updateSetting(key, val) {
    const s = loadSettings();
    s[key] = val;
    saveSettings(s);

    if (key === "fontSize" && editors.length) {
        editors[0].dispatch({ effects: fontSizeConf.reconfigure(EditorView.theme({ "&": { fontSize: val + "px" }, ".cm-scroller": { fontSize: val + "px" } })) });
    }
    if (key === "tabSize" && editors.length) {
        editors[0].dispatch({ effects: tabSizeConf.reconfigure(EditorState.tabSize.of(val)) });
    }
    if (key === "wordWrap" && editors.length) {
        editors[0].dispatch({ effects: wrapConf.reconfigure(val ? EditorView.lineWrapping : []) });
    }
    updateStatus();
}

function shareURL() {
    saveCurFile();
    const url = new URL(window.location);
    const data = files.length > 1 ? { files } : { lang: files[0].lang, code: files[0].code };
    url.hash = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    window.history.replaceState(null, "", url);
    navigator.clipboard.writeText(url.toString()).then(() => {
        const t = $("#share-toast"); t.textContent = "Link copied!"; t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 2000);
    });
}

function loadFromURL() {
    try {
        const hash = window.location.hash.slice(1);
        if (!hash) return null;
        return JSON.parse(decodeURIComponent(escape(atob(hash))));
    } catch { return null; }
}

function checkShareURL() {
    const data = loadFromURL();
    if (data) {
        window.location.hash = "";
    }
}

function applySavedTheme() {
    const themeId = localStorage.getItem(SK_THEME);
    if (themeId) {
        const enabled = getEnabled();
        if (enabled.includes(themeId)) applyTheme(themeId);
        else { localStorage.removeItem(SK_THEME); removeTheme(); }
    }
}

function applyTheme(id) {
    removeTheme();
    const p = PLUGINS.find(x => x.id === id);
    if (!p || !p.css) return;
    document.body.classList.add("theme-" + p.css);
    localStorage.setItem(SK_THEME, id);
}

function removeTheme() { document.body.className = document.body.className.split(" ").filter(c => !c.startsWith("theme-")).join(" "); }

function getInstalled() { try { return JSON.parse(localStorage.getItem(SK_PLUGINS)) || []; } catch { return []; } }
function setInstalled(arr) { localStorage.setItem(SK_PLUGINS, JSON.stringify(arr)); }
function getEnabled() { try { return JSON.parse(localStorage.getItem(SK_ENABLED)) || []; } catch { return []; } }
function setEnabled(arr) { localStorage.setItem(SK_ENABLED, JSON.stringify(arr)); }

function initPlugins() {
    const btn = $("#plugin-btn");
    const panel = $("#plugin-panel");
    const close = $("#plugin-close");
    const search = $("#plugin-search");

    btn.addEventListener("click", togglePluginPanel);
    close.addEventListener("click", togglePluginPanel);
    search.addEventListener("input", renderPlugins);

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && panel.classList.contains("open")) togglePluginPanel();
    });
    panel.addEventListener("click", e => { if (e.target === panel) togglePluginPanel(); });
}

function togglePluginPanel() {
    const p = $("#plugin-panel");
    const open = p.classList.contains("open");
    if (open) {
        p.classList.remove("open"); p.classList.add("closed"); $("#plugin-btn").classList.remove("active");
    } else {
        if ($("#settings-panel").classList.contains("open")) toggleSettings();
        p.classList.remove("closed"); p.classList.add("open"); $("#plugin-btn").classList.add("active");
        renderPlugins();
    }
}

function renderPlugins() {
    const installed = getInstalled();
    const enabled = getEnabled();
    const query = ($("#plugin-search").value || "").toLowerCase();
    const builtinIds = new Set(BUILTIN_PLUGINS.map(p => p.id));

    const experimental = [];
    const byCat = {};
    const community = [];

    PLUGINS.forEach(p => {
        if (query && !p.name.toLowerCase().includes(query) && !p.desc.toLowerCase().includes(query)) return;
        const isBuiltin = builtinIds.has(p.id);
        if (isBuiltin && p.upcoming) {
            experimental.push(p);
        } else if (!isBuiltin) {
            community.push(p);
        } else {
            if (!byCat[p.cat]) byCat[p.cat] = [];
            byCat[p.cat].push(p);
        }
    });

    const catNames = { language: "Languages", ai: "AI Assistants", engine: "Engines", theme: "Themes" };
    let html = "";

    function entry(p) {
        const isInstalled = installed.includes(p.id);
        const isEnabled = enabled.includes(p.id);
        const upcoming = p.upcoming;
        const isCommunity = !builtinIds.has(p.id);
        return `<div class="plugin-entry">
            <div class="plugin-info">
                <div class="plugin-name">${esc(p.name)}${isEnabled && !upcoming ? ' <span class="plugin-active-badge">on</span>' : ''}${upcoming ? ' <span class="plugin-upcoming-badge">exp</span>' : ''}${isCommunity ? ' <span class="plugin-community-badge">community</span>' : ''}</div>
                <div class="plugin-desc">${esc(p.desc)}</div>
                ${p.ver ? `<div class="plugin-version">v${p.ver}</div>` : ''}
            </div>
            <div class="plugin-action" data-plugin="${p.id}">
                ${upcoming ? (p.id === "plugin-creator" ? '<button class="btn-install">Open</button>' : '<span class="plugin-disabled">Experimental</span>') : (isInstalled ? `<button class="btn-enable${isEnabled ? ' enabled' : ''}">${isEnabled ? 'Disable' : 'Enable'}</button><button class="btn-remove">&times;</button>` : '<button class="btn-install">Install</button>')}
            </div>
        </div>`;
    }

    if (experimental.length) {
        html += `<div class="plugin-cat-header experimental-hdr">Experimental</div>`;
        experimental.forEach(p => { html += entry(p); });
    }

    for (const [cat, plugins] of Object.entries(byCat)) {
        html += `<div class="plugin-cat-header">${catNames[cat] || cat}</div>`;
        plugins.forEach(p => { html += entry(p); });
    }

    if (community.length) {
        html += `<div class="plugin-cat-header community-hdr">Community</div>`;
        community.forEach(p => { html += entry(p); });
    }

    $("#plugin-list").innerHTML = html;

    $("#plugin-list").querySelectorAll(".plugin-action button").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            const id = btn.closest(".plugin-action").dataset.plugin;
            if (id === "plugin-creator") {
                const overlay = $("#plugin-create-overlay");
                if (overlay) {
                    overlay.classList.remove("hidden");
                    const err = $("#pcf-error"); if (err) err.classList.add("hidden");
                    const ok = $("#pcf-success"); if (ok) ok.classList.add("hidden");
                    const form = $("#plugin-create-form"); if (form) form.reset();
                    toggleCatFields();
                }
                return;
            }
            const action = btn.classList.contains("btn-install") ? "install" : btn.classList.contains("btn-remove") ? "remove" : btn.classList.contains("btn-enable") && btn.classList.contains("enabled") ? "disable" : "enable";
            handlePlugin(id, action);
        });
    });
}

function handlePlugin(id, action) {
    let installed = getInstalled();
    let enabled = getEnabled();
    switch (action) {
        case "install": installed.push(id); enabled.push(id); break;
        case "remove": installed = installed.filter(x => x !== id); enabled = enabled.filter(x => x !== id); break;
        case "enable": if (!enabled.includes(id)) enabled.push(id); break;
        case "disable": enabled = enabled.filter(x => x !== id); break;
    }
    setInstalled(installed);
    setEnabled(enabled);
    if (PLUGINS.find(p => p.id === id && p.cat === "language")) buildLangSelector();
    if (PLUGINS.find(p => p.id === id && p.cat === "theme")) {
        if (action === "enable" || action === "install") applyTheme(id);
        else if (action === "disable" || action === "remove") { removeTheme(); localStorage.removeItem(SK_THEME); }
    }
    updateStatus();
    renderPlugins();
}

function initCreatePlugin() {
    const createBtn = $("#btn-create-plugin");
    if (!createBtn) return;
    createBtn.addEventListener("click", () => {
        const overlay = $("#plugin-create-overlay");
        if (!overlay) return;
        overlay.classList.remove("hidden");
        const err = $("#pcf-error"); if (err) err.classList.add("hidden");
        const ok = $("#pcf-success"); if (ok) ok.classList.add("hidden");
        const form = $("#plugin-create-form"); if (form) form.reset();
        toggleCatFields();
    });
    const cancel = $("#pcf-cancel");
    if (cancel) cancel.addEventListener("click", () => {
        const overlay = $("#plugin-create-overlay");
        if (overlay) overlay.classList.add("hidden");
    });
    const overlay = $("#plugin-create-overlay");
    if (overlay) overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.add("hidden");
    });
    const cat = $("#pcf-cat");
    if (cat) cat.addEventListener("change", toggleCatFields);
    const form = $("#plugin-create-form");
    if (form) form.addEventListener("submit", async e => {
        e.preventDefault();
        const name = $("#pcf-name").value.trim();
        const desc = $("#pcf-desc").value.trim();
        const cat = $("#pcf-cat").value;
        const ver = $("#pcf-ver").value.trim();
        const tpl = $("#pcf-tpl").value.trim();
        const css = $("#pcf-css").value.trim();
        const source_filename = $("#pcf-filename").value.trim() || null;
        const run_cmd = $("#pcf-run").value.trim();
        let compile_cmd = $("#pcf-compile").value.trim();

        if (!name || !desc || !cat) {
            $("#pcf-error").textContent = "Name, description, and category are required.";
            $("#pcf-error").classList.remove("hidden");
            return;
        }

        const body = { name, desc, cat, ver };
        if (cat === "language") {
            if (tpl) body.tpl = tpl;
            if (source_filename) body.source_filename = source_filename;
            if (run_cmd) body.run_cmd = run_cmd.split(/\s+/).filter(Boolean);
            if (compile_cmd) body.compile_cmd = compile_cmd.split(/\s+/).filter(Boolean);
        }
        if (cat === "theme" && css) body.css = css;

        try {
            const btn = $("#plugin-create-form").querySelector(".btn-submit");
            btn.disabled = true;
            btn.textContent = "Submitting...";
            const resp = await fetch(API_BASE + "/api/plugins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            btn.disabled = false;
            btn.textContent = "Submit for Review";

            if (!resp.ok) {
                $("#pcf-error").textContent = data.error || "Failed to submit plugin.";
                $("#pcf-error").classList.remove("hidden");
                $("#pcf-success").classList.add("hidden");
            } else {
                $("#pcf-error").classList.add("hidden");
                $("#pcf-success").classList.remove("hidden");
                setTimeout(() => {
                    $("#plugin-create-overlay").classList.add("hidden");
                    fetchApprovedPlugins();
                }, 1500);
            }
        } catch (err) {
            $("#pcf-error").textContent = "Network error: " + err.message;
            $("#pcf-error").classList.remove("hidden");
            const btn = $("#plugin-create-form").querySelector(".btn-submit");
            btn.disabled = false;
            btn.textContent = "Submit for Review";
        }
    });
}

function toggleCatFields() {
    const catEl = $("#pcf-cat");
    if (!catEl) return;
    const cat = catEl.value;
    const langF = $("#pcf-lang-fields"); if (langF) langF.classList.toggle("hidden", cat !== "language");
    const themeF = $("#pcf-theme-fields"); if (themeF) themeF.classList.toggle("hidden", cat !== "theme");
    const engF = $("#pcf-engine-fields"); if (engF) engF.classList.toggle("hidden", cat !== "engine");
    const aiF = $("#pcf-ai-fields"); if (aiF) aiF.classList.toggle("hidden", cat !== "ai");
    const runReq = $("#pcf-run");
    if (runReq) {
        if (cat === "language") runReq.setAttribute("required", "");
        else runReq.removeAttribute("required");
    }
}

function initAdmin() {
    const btn = $("#btn-admin");
    if (!btn) return;
    const savedKey = localStorage.getItem(SK_ADMIN_KEY);
    if (savedKey) {
        const keyInput = $("#admin-key");
        if (keyInput) keyInput.value = savedKey;
    }

    btn.addEventListener("click", () => {
        const overlay = $("#admin-overlay");
        if (!overlay) return;
        overlay.classList.remove("hidden");
        const err = $("#admin-error");
        if (err) err.classList.add("hidden");
        if (savedKey) fetchPending();
    });

    const close = $("#admin-close");
    if (close) close.addEventListener("click", () => {
        const overlay = $("#admin-overlay");
        if (overlay) overlay.classList.add("hidden");
    });

    const overlay = $("#admin-overlay");
    if (overlay) overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.add("hidden");
    });

    const login = $("#admin-login-btn");
    if (login) login.addEventListener("click", () => {
        const keyInput = $("#admin-key");
        if (!keyInput) return;
        const key = keyInput.value.trim();
        if (!key) {
            const err = $("#admin-error");
            if (err) { err.textContent = "Enter an API key."; err.classList.remove("hidden"); }
            return;
        }
        localStorage.setItem(SK_ADMIN_KEY, key);
        const err = $("#admin-error");
        if (err) err.classList.add("hidden");
        fetchPending(key);
    });

    const refresh = $("#admin-refresh");
    if (refresh) refresh.addEventListener("click", () => {
        const keyInput = $("#admin-key");
        const key = (keyInput ? keyInput.value.trim() : "") || localStorage.getItem(SK_ADMIN_KEY);
        fetchPending(key);
    });
}

async function fetchPending(key) {
    const keyInput = $("#admin-key");
    key = key || (keyInput ? keyInput.value.trim() : "") || localStorage.getItem(SK_ADMIN_KEY);
    if (!key) {
        const err = $("#admin-error");
        if (err) { err.textContent = "No API key set."; err.classList.remove("hidden"); }
        return;
    }
    const errEl = $("#admin-error");
    if (errEl) errEl.classList.add("hidden");

    try {
        const resp = await fetch(API_BASE + "/api/plugins/pending", {
            headers: { "x-api-key": key },
        });
        if (!resp.ok) {
            if (resp.status === 401) {
                localStorage.removeItem(SK_ADMIN_KEY);
                if (errEl) { errEl.textContent = "Invalid API key."; errEl.classList.remove("hidden"); }
            } else {
                if (errEl) { errEl.textContent = "Server error: " + resp.status; errEl.classList.remove("hidden"); }
            }
            const adminList = $("#admin-list");
            if (adminList) adminList.classList.add("hidden");
            return;
        }
        const data = await resp.json();
        renderPending(data.plugins || []);
        const adminList = $("#admin-list");
        if (adminList) adminList.classList.remove("hidden");
    } catch (e) {
        if (errEl) { errEl.textContent = "Network error: " + e.message; errEl.classList.remove("hidden"); }
    }
}

function renderPending(plugins) {
    const list = $("#admin-pending-list");
    if (!list) return;
    $("#admin-count").textContent = plugins.length;

    if (!plugins.length) {
        list.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:12px 0">No pending plugins.</div>';
        return;
    }

    const key = ($("#admin-key") ? $("#admin-key").value.trim() : "") || localStorage.getItem(SK_ADMIN_KEY);

    list.innerHTML = plugins.map(p => `
        <div class="admin-pending-entry" data-id="${p.id}">
            <div class="ap-info">
                <div class="ap-name">${esc(p.name)} <span style="font-size:8px;color:var(--text-dim)">${p.cat}</span></div>
                <div class="ap-desc">${esc(p.desc)}</div>
                <div class="ap-meta">v${p.ver || "?"} · ${p.submitted_at || ""}</div>
            </div>
            <div class="ap-actions">
                <button class="ap-approve" onclick="window._adminAction('approve','${p.id}')">Approve</button>
                <button class="ap-reject" onclick="window._adminAction('reject','${p.id}')">Reject</button>
                <button class="ap-delete" onclick="window._adminAction('delete','${p.id}')">&times;</button>
            </div>
        </div>
    `).join("");

    window._adminAction = async (action, id) => {
        const btn = list.querySelector(`[data-id="${id}"] .ap-${action === "delete" ? "delete" : action}`);
        if (btn) { btn.disabled = true; btn.textContent = "..."; }

        try {
            let resp;
            if (action === "delete") {
                resp = await fetch(`${API_BASE}/api/plugins/${id}`, {
                    method: "DELETE",
                    headers: { "x-api-key": key },
                });
            } else {
                resp = await fetch(`${API_BASE}/api/plugins/${id}/${action}`, {
                    method: "POST",
                    headers: { "x-api-key": key },
                });
            }

            if (resp.ok) {
                plugins = plugins.filter(p => p.id !== id);
                renderPending(plugins);
                fetchApprovedPlugins();
            } else {
                const err = await resp.json().catch(() => ({}));
                alert(`Failed: ${err.error || resp.status}`);
                if (btn) { btn.disabled = false; btn.textContent = action.charAt(0).toUpperCase() + action.slice(1); }
            }
        } catch (e) {
            alert("Network error: " + e.message);
            if (btn) { btn.disabled = false; btn.textContent = action.charAt(0).toUpperCase() + action.slice(1); }
        }
    };
}

// Mobile touch detection for keyboard bar
if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
    let longPressTimer;
    document.addEventListener("touchstart", e => {
        const tgt = e.target.closest(".cm-content, #fallback-editor");
        if (!tgt) return;
        longPressTimer = setTimeout(() => {
            $("#keyboard-bar").classList.remove("hidden");
        }, 600);
    }, { passive: true });
    document.addEventListener("touchend", () => clearTimeout(longPressTimer));
    document.addEventListener("touchmove", () => clearTimeout(longPressTimer));
}

init().catch(() => {});
