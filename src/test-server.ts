/**
 * Test script for the ZenStack MCP server.
 * Spawns the MCP server process and tests the tools via JSON-RPC.
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: unknown;
}

function sendRequest(
  proc: ReturnType<typeof spawn>,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const line = JSON.stringify(request) + "\n";
    proc.stdin!.write(line);

    const onLine = (data: string) => {
      try {
        const response = JSON.parse(data) as JsonRpcResponse;
        if (response.id === request.id) {
          proc.stdout!.removeListener("line", onLine);
          resolve(response);
        }
      } catch {
        // Not JSON, skip
      }
    };

    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    rl.on("line", onLine);

    setTimeout(() => {
      proc.stdout!.removeListener("line", onLine);
      reject(new Error(`Timeout waiting for response to ${request.method}`));
    }, 15000);
  });
}

async function main() {
  console.log("Starting MCP server process...\n");

  const proc = spawn("npx", ["tsx", join(__dirname, "mcp-server.ts")], {
    cwd: join(__dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stderr = "";
  proc.stderr!.on("data", (data) => {
    stderr += data.toString();
  });

  // Give the server a moment to initialize
  await new Promise((r) => setTimeout(r, 1000));

  let id = 0;

  try {
    // 1. Initialize
    console.log("1. Testing initialize...");
    const initResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    console.log("Initialize response:", initResp.result ? "OK" : "FAIL");

    // Send initialized notification
    proc.stdin!.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    await new Promise((r) => setTimeout(r, 200));

    // 2. List tools
    console.log("\n2. Testing tools/list...");
    const listResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/list",
    });
    const tools = (listResp.result as any)?.tools || [];
    console.log("Available tools:", tools.map((t: any) => t.name).join(", "));

    // 3. Call schema tool
    console.log("\n3. Testing schema tool...");
    const schemaResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name: "schema", arguments: {} },
    });
    const schemaText = (schemaResp.result as any)?.content?.[0]?.text || "";
    console.log("Schema response length:", schemaText.length, "chars");
    console.log("Schema first 200 chars:", schemaText.substring(0, 200));

    // 4. Call check tool - valid
    console.log("\n4. Testing check tool (valid)...");
    const checkResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          model: "user",
          operation: "findMany",
          args: JSON.stringify({ where: { email: "test@test.com" } }),
        },
      },
    });
    const checkText = (checkResp.result as any)?.content?.[0]?.text || "";
    console.log("Check result:", checkText.substring(0, 200));

    // 5. Call check tool - invalid operation
    console.log("\n5. Testing check tool (invalid operation)...");
    const checkInvalidResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          model: "user",
          operation: "invalidOp",
          args: JSON.stringify({}),
        },
      },
    });
    const checkInvalidText =
      (checkInvalidResp.result as any)?.content?.[0]?.text || "";
    console.log("Check invalid result:", checkInvalidText.substring(0, 200));

    // 6. Call execute tool
    console.log("\n6. Testing execute tool (findMany)...");
    const execResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: {
        name: "execute",
        arguments: {
          model: "user",
          operation: "findMany",
          args: JSON.stringify({}),
        },
      },
    });
    const execText = (execResp.result as any)?.content?.[0]?.text || "";
    const execError = (execResp.result as any)?.isError;
    console.log(
      "Execute result:",
      execError
        ? "ERROR: " + execText.substring(0, 200)
        : execText.substring(0, 200),
    );

    // 7. Test type check failure
    console.log("\n7. Testing check tool (type error - wrong field type)...");
    const checkTypeErrResp = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: {
        name: "check",
        arguments: {
          model: "user",
          operation: "findMany",
          args: JSON.stringify({ where: { email: 123 } }), // email should be string, not number
        },
      },
    });
    const checkTypeErrText =
      (checkTypeErrResp.result as any)?.content?.[0]?.text || "";
    console.log("Type check result:", checkTypeErrText.substring(0, 300));
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    proc.kill();
    if (stderr) console.log("\n--- Server stderr ---\n", stderr);
  }
}

main();
