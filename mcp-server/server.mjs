import { createInterface } from "node:readline";

const API_BASE = "http://localhost:3000";

const TOOLS = [
    {
        name: "list_languages",
        description: "List all available programming languages on simplelanguages.com. Returns language IDs, names, versions, and file extensions.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "execute_code",
        description: "Execute code in a specific programming language. Supports Python, JavaScript, TypeScript, Java, C, C++, C#, and Rust. Returns stdout, stderr, exit code, and execution time.",
        inputSchema: {
            type: "object",
            properties: {
                language: {
                    type: "string",
                    description: "The language ID (e.g. 'python', 'javascript', 'rust')",
                },
                code: {
                    type: "string",
                    description: "The source code to execute",
                },
                stdin: {
                    type: "string",
                    description: "Optional standard input for the program",
                },
            },
            required: ["language", "code"],
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
            send(id, {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: {
                    name: "simplelanguages-mcp",
                    version: "1.0.0",
                },
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
                send(id, {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                });
            } catch (e) {
                send(id, {
                    content: [{ type: "text", text: `Error: ${e.message}` }],
                    isError: true,
                });
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
