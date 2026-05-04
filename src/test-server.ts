/**
 * Test script for the ZenStack MCP server (HTTP mode).
 * Sends JSON-RPC requests to the HTTP endpoint.
 */

const BASE = `http://localhost:${process.env.PORT || 3000}/mcp`;

let sessionId: string | null = null;
let id = 0;

function parseSSE(body: string): string | null {
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      return line.slice(6);
    }
  }
  return null;
}

async function rpc(method: string, params?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method,
      params,
    }),
  });

  const newSessionId = res.headers.get("mcp-session-id");
  if (newSessionId) sessionId = newSessionId;

  const text = await res.text();
  const json = parseSSE(text);
  if (json) return JSON.parse(json);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  console.log("Testing ZenStack MCP HTTP server...\n");

  // 1. Initialize
  console.log("1. Testing initialize...");
  const initResp = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  console.log(
    "Initialize response:",
    initResp.result ? `OK (session: ${sessionId})` : "FAIL",
  );

  if (!initResp.result) {
    console.error("Initialization failed, aborting.");
    process.exit(1);
  }

  // Send initialized notification
  await rpc("notifications/initialized");

  // 2. List tools
  console.log("\n2. Testing tools/list...");
  const listResp = await rpc("tools/list");
  const tools = (listResp.result as any)?.tools || [];
  console.log("Available tools:", tools.map((t: any) => t.name).join(", "));

  // 3. Call schema tool
  console.log("\n3. Testing schema tool...");
  const schemaResp = await rpc("tools/call", {
    name: "schema",
    arguments: {},
  });
  const schemaText = (schemaResp.result as any)?.content?.[0]?.text || "";
  console.log("Schema response length:", schemaText.length, "chars");
  console.log("Schema first 200 chars:", schemaText.substring(0, 200));

  // 4. Call check tool - valid
  console.log("\n4. Testing check tool (valid)...");
  const checkResp = await rpc("tools/call", {
    name: "check",
    arguments: {
      model: "user",
      operation: "findMany",
      args: JSON.stringify({ where: { email: "test@test.com" } }),
    },
  });
  const checkText = (checkResp.result as any)?.content?.[0]?.text || "";
  console.log("Check result:", checkText.substring(0, 200));

  // 5. Call check tool - invalid operation
  console.log("\n5. Testing check tool (invalid operation)...");
  const checkInvalidResp = await rpc("tools/call", {
    name: "check",
    arguments: {
      model: "user",
      operation: "invalidOp",
      args: JSON.stringify({}),
    },
  });
  const checkInvalidText =
    (checkInvalidResp.result as any)?.content?.[0]?.text || "";
  console.log("Check invalid result:", checkInvalidText.substring(0, 200));

  // 6. Call execute tool
  console.log("\n6. Testing execute tool (findMany)...");
  const execResp = await rpc("tools/call", {
    name: "execute",
    arguments: {
      model: "user",
      operation: "findMany",
      args: JSON.stringify({}),
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
  const checkTypeErrResp = await rpc("tools/call", {
    name: "check",
    arguments: {
      model: "user",
      operation: "findMany",
      args: JSON.stringify({ where: { email: 123 } }),
    },
  });
  const checkTypeErrText =
    (checkTypeErrResp.result as any)?.content?.[0]?.text || "";
  console.log("Type check result:", checkTypeErrText.substring(0, 300));

  console.log("\n✅ All tests completed!");
}

main().catch((error) => {
  console.error("Test error:", error);
  process.exit(1);
});
