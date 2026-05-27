import { createInterface } from "node:readline";

const LOCAL_API = "http://localhost:3000";
const REMOTE_API = "https://simplelanguages-backend.onrender.com";
let API_BASE = REMOTE_API;

async function detectApi() {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch(LOCAL_API + "/api/health", { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) {
            API_BASE = LOCAL_API;
            process.stderr.write("[simplelanguages-mcp] using local backend\n");
            return;
        }
    } catch {}
    process.stderr.write("[simplelanguages-mcp] using remote backend\n");
}

const TOOLS = [
    {
        name: "list_languages",
        description: "List all available programming languages on simplelanguages.com. Returns language IDs, names, versions, and file extensions.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "execute_code",
        description: "Execute code in a specific programming language. Supports Python, JavaScript, TypeScript, Java, C, C++, C#, Rust, Lua, Go, Ruby, PHP, HTML, CSS. Returns stdout, stderr, exit code, and execution time.",
        inputSchema: {
            type: "object",
            properties: {
                language: { type: "string", description: "The language ID (e.g. 'python', 'javascript', 'rust')" },
                code: { type: "string", description: "The source code to execute" },
                stdin: { type: "string", description: "Optional standard input for the program" },
            },
            required: ["language", "code"],
        },
    },
    {
        name: "list_plugins",
        description: "List all approved community plugins on simplelanguages.com. Returns plugin IDs, names, descriptions, categories, and versions.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "submit_plugin",
        description: "Submit a new community plugin for review on simplelanguages.com. Plugins go into a pending queue for owner approval before being published.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Plugin display name" },
                description: { type: "string", description: "Plugin description (max 200 chars)" },
                category: { type: "string", description: "Category: 'language', 'theme', 'engine', or 'ai'" },
                version: { type: "string", description: "Version string, e.g. '1.0.0'" },
                template: { type: "string", description: "(language) Default code template shown to users" },
                run_command: { type: "string", description: "(language) Command to run the code, e.g. 'python3 {file}'" },
                compile_command: { type: "string", description: "(language, optional) Compile command, e.g. 'gcc {file} -o {dir}/main'" },
                source_filename: { type: "string", description: "(language) Source filename, e.g. 'main.py'" },
                css_class: { type: "string", description: "(theme) CSS class name for the theme" },
            },
            required: ["name", "description", "category"],
        },
    },
];

function send(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, code, message) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handleRequest(msg) {
    const { id, method, params } = msg;

    switch (method) {
        case "initialize":
            await detectApi();
            send(id, {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "simplelanguages-mcp", version: "2.0.0" },
            });
            break;

        case "notifications/initialized":
            break;

        case "tools/list":
            send(id, { tools: TOOLS });
            break;

        case "tools/call":
            try {
                const result = await handleToolCall(params.name, params.arguments);
                send(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
            } catch (e) {
                send(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
            }
            break;

        default:
            sendError(id, -32601, `Method not found: ${method}`);
    }
}

async function handleToolCall(name, args) {
    switch (name) {
        case "list_languages": {
            const resp = await fetch(`${API_BASE}/api/languages`);
            if (!resp.ok) throw new Error(`API error: ${resp.status}`);
            return await resp.json();
        }
        case "execute_code": {
            const resp = await fetch(`${API_BASE}/api/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    language: args.language,
                    code: args.code,
                    stdin: args.stdin || "",
                }),
            });
            return await resp.json();
        }
        case "list_plugins": {
            const resp = await fetch(`${API_BASE}/api/plugins`);
            if (!resp.ok) throw new Error(`API error: ${resp.status}`);
            return await resp.json();
        }
        case "submit_plugin": {
            const body = {
                name: args.name,
                desc: args.description,
                cat: args.category,
                ver: args.version || "",
            };
            if (args.template) body.tpl = args.template;
            if (args.run_command) body.run_cmd = args.run_command.split(/\s+/).filter(Boolean);
            if (args.compile_command) body.compile_cmd = args.compile_command.split(/\s+/).filter(Boolean);
            if (args.source_filename) body.source_filename = args.source_filename;
            if (args.css_class) body.css = args.css_class;

            const resp = await fetch(`${API_BASE}/api/plugins`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Submission failed: ${resp.status}`);
            }
            return await resp.json();
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
    try {
        const msg = JSON.parse(line);
        handleRequest(msg).catch(() => {});
    } catch {}
});

process.stderr.write("[simplelanguages-mcp] started\n");
