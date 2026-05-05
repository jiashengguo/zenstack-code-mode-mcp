import { randomUUID } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer, isInitializeRequest } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { getDb, getAuthDb } from "./db.js";
import { userContext } from "./context.js";
import { AuthMiddleware } from "./auth/AuthMiddleware.js";
import { config } from "./config.js";
import { schema } from "../zenstack/schema.js";
import type { Request, Response } from "express";

// ─── Helpers ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function readZModel(): string {
  return readFileSync(join(projectRoot, "zenstack", "schema.zmodel"), "utf-8");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Map operation names to the suffix used in generated type names
const OP_TYPE_SUFFIX: Record<string, string> = {
  findMany: "FindManyArgs",
  findUnique: "FindUniqueArgs",
  findFirst: "FindFirstArgs",
  findFirstOrThrow: "FindFirstOrThrowArgs",
  findUniqueOrThrow: "FindUniqueOrThrowArgs",
  exists: "ExistsArgs",
  create: "CreateArgs",
  createMany: "CreateManyArgs",
  createManyAndReturn: "CreateManyAndReturnArgs",
  update: "UpdateArgs",
  updateMany: "UpdateManyArgs",
  updateManyAndReturn: "UpdateManyAndReturnArgs",
  upsert: "UpsertArgs",
  delete: "DeleteArgs",
  deleteMany: "DeleteManyArgs",
  count: "CountArgs",
  aggregate: "AggregateArgs",
  groupBy: "GroupByArgs",
};

const VALID_OPERATIONS = Object.keys(OP_TYPE_SUFFIX);

// Get available model names from the schema (lowercase)
function getAvailableModels(): string[] {
  return Object.keys(schema.models)
    .map((m) => m.charAt(0).toLowerCase() + m.slice(1))
    .sort();
}

// ─── Type Checking (check tool) ────────────────────────────────────────

function typeCheckArgs(
  model: string,
  operation: string,
  argsJson: string,
): string | null {
  const modelCapitalized = capitalize(model);
  const typeSuffix = OP_TYPE_SUFFIX[operation];
  if (!typeSuffix) {
    return `Unknown operation: "${operation}". Valid operations: ${VALID_OPERATIONS.join(", ")}`;
  }
  const typeName = `${modelCapitalized}${typeSuffix}`;

  // Create a temporary directory for type checking
  const tmpDir = mkdtempSync(join(projectRoot, ".typecheck-"));
  const checkFile = join(tmpDir, "check.ts");

  try {
    // Write a tiny TypeScript file that imports the type and assigns the args
    const sourceCode = `import type { ${typeName} } from '../zenstack/input';
const _check: ${typeName} = ${argsJson};
`;

    writeFileSync(checkFile, sourceCode, "utf-8");

    // Read tsconfig
    const tsconfigPath = join(projectRoot, "tsconfig.json");
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      projectRoot,
    );

    // Create program and check diagnostics
    const program = ts.createProgram({
      rootNames: [checkFile],
      options: {
        ...parsedConfig.options,
        noEmit: true,
        skipLibCheck: true,
      },
      host: ts.createCompilerHost(parsedConfig.options),
    });

    const diagnostics = ts.getPreEmitDiagnostics(program);
    const errors = diagnostics
      .filter((d) => d.file?.fileName.includes("check.ts"))
      .map((d) => {
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        let position = "";
        if (d.file && d.start !== undefined) {
          const { line, character } = d.file.getLineAndCharacterOfPosition(
            d.start,
          );
          position = ` (line ${line + 1}, col ${character + 1})`;
        }
        return `- ${message}${position}`;
      });

    if (errors.length > 0) {
      return `Type check failed:\n${errors.join("\n")}`;
    }

    return null; // No errors
  } finally {
    // Clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Query Execution (execute tool) ────────────────────────────────────

async function executeQuery(
  model: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const userId = userContext.getStore();
  const db = userId ? getAuthDb(userId) : getDb();

  // Access model dynamically (db.user, db.post, etc.)
  const modelAccess = (db as Record<string, unknown>)[model];
  if (!modelAccess) {
    throw new Error(
      `Model "${model}" not found. Available models: ${getAvailableModels().join(", ")}`,
    );
  }

  const operationFn = (modelAccess as Record<string, Function>)[operation];
  if (!operationFn) {
    throw new Error(
      `Operation "${operation}" not found on model "${model}". ` +
        `Valid operations: ${VALID_OPERATIONS.join(", ")}`,
    );
  }

  const result = await operationFn.call(modelAccess, args);
  return result;
}

// ─── Schema Rules ──────────────────────────────────────────────────────

function getSchemaRules(): string {
  return `
## ZenStack Query API Rules

### Available Operations
Each model supports the following Prisma-style query operations:
- **findMany**: Query multiple records with optional filtering, sorting, pagination
- **findUnique**: Find a single record by unique identifier
- **findFirst** / **findFirstOrThrow**: Find the first matching record
- **findUniqueOrThrow**: Find unique or throw if not found
- **exists**: Check if records matching criteria exist (returns boolean)
- **create**: Create a single record
- **createMany**: Create multiple records in bulk
- **createManyAndReturn**: Create multiple records and return them
- **update**: Update a single record by unique identifier
- **updateMany**: Update multiple records matching criteria
- **updateManyAndReturn**: Update multiple records and return them
- **upsert**: Update or create a record
- **delete**: Delete a single record by unique identifier
- **deleteMany**: Delete multiple records matching criteria
- **count**: Count records matching criteria
- **aggregate**: Perform aggregations (sum, avg, min, max, count)
- **groupBy**: Group records and perform aggregations

### Common Arguments
All query operations support these optional arguments:
- **where**: Filter conditions (matches field values, supports operators like equals, contains, gt, lt, in, notIn, AND, OR, NOT)
- **select**: Specify which fields to return (cannot be used with include)
- **include**: Include related records (cannot be used with select)
- **omit**: Exclude specific fields from the result

### Nested CRUD Operations
When creating or updating records, you can perform nested operations on relations:
- **create**: { data: { posts: { create: [{ title: "Hello" }] } } }
- **createMany**: { data: { posts: { createMany: { data: [...] } } } }
- **connect**: { data: { author: { connect: { id: "..." } } } }
- **disconnect**: { data: { author: { disconnect: true } } }
- **set**: { data: { author: { set: { id: "..." } } } }  (for optional relations)
- **update**: { data: { posts: { update: { where: { id: "..." }, data: { title: "New" } } } } }
- **delete**: { data: { posts: { delete: { id: "..." } } } }
- **updateMany**: { data: { posts: { updateMany: { where: {...}, data: {...} } } } }
- **deleteMany**: { data: { posts: { deleteMany: { where: {...} } } } }

### Relation Field Selection
Use **include** to eagerly load relations:
\`\`\`json
{ "include": { "posts": true } }
\`\`\`

Use nested **select** to pick specific fields from relations:
\`\`\`json
{ "include": { "posts": { "select": { "title": true } } } }
\`\`\`

Use nested **where** to filter related records:
\`\`\`json
{ "include": { "posts": { "where": { "published": true } } } }
\`\`\`

### Relation Filtering
Filter by related record fields using dot notation in where:
\`\`\`json
{ "where": { "author": { "email": { "contains": "@example.com" } } } }
\`\`\`

### Examples
Find all published posts with their author:
\`\`\`json
{ "operation": "findMany", "args": { "where": { "published": true }, "include": { "author": true } } }
\`\`\`

Create a user with nested posts:
\`\`\`json
{ "operation": "create", "args": { "data": { "email": "user@example.com", "posts": { "create": [{ "title": "My Post", "content": "Hello" }] } } } }
\`\`\`

Count users with specific email domain:
\`\`\`json
{ "operation": "count", "args": { "where": { "email": { "contains": "@example.com" } } } }
\`\`\`
`;
}

// ─── MCP Server ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "zenstack-mcp",
  version: "1.0.0",
});

// ── Tool: schema ───────────────────────────────────────────────────────

server.registerTool(
  "schema",
  {
    description:
      "Get the complete zmodel schema, available query APIs, and rules for complex query patterns.",
    inputSchema: z.object({}),
  },
  async () => {
    const zmodel = readZModel();
    const rules = getSchemaRules();

    const apis = VALID_OPERATIONS.join("\n");

    const result = [
      "# ZModel Schema",
      "```zmodel",
      zmodel,
      "```",
      "",
      "# Available Query APIs",
      apis,
      "",
      "# Query Rules & Examples",
      rules,
    ].join("\n");

    return {
      content: [{ type: "text", text: result }],
    };
  },
);

// ── Tool: check ────────────────────────────────────────────────────────

server.registerTool(
  "check",
  {
    description:
      "Validate a query function call before execution. Performs TypeScript type checking to ensure the operation and arguments are valid for the given model.",
    inputSchema: z.object({
      model: z.string().describe('The model name (e.g., "user", "post")'),
      operation: z
        .string()
        .describe('The operation name (e.g., "findMany", "create", "update")'),
      args: z
        .string()
        .describe(
          'The arguments as a JSON string (e.g., \'{"where":{"id":"abc"}}\')',
        ),
    }),
  },
  async ({ model, operation, args }) => {
    // Validate JSON
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      return {
        content: [
          { type: "text", text: `Error: Invalid JSON in args: ${args}` },
        ],
        isError: true,
      };
    }

    // Validate model exists
    const models = getAvailableModels();
    if (!models.includes(model)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Model "${model}" not found. Available models: ${models.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Validate operation
    if (!VALID_OPERATIONS.includes(operation)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown operation "${operation}". Valid operations: ${VALID_OPERATIONS.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Check operation is available
    if (!VALID_OPERATIONS.includes(operation)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Operation "${operation}" is not available for model "${model}". Available: ${VALID_OPERATIONS.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Perform TypeScript type checking
    const typeError = typeCheckArgs(
      model,
      operation,
      JSON.stringify(parsedArgs),
    );
    if (typeError) {
      return {
        content: [{ type: "text", text: typeError }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `✅ Valid: ${model}.${operation}(${JSON.stringify(parsedArgs)})`,
        },
      ],
    };
  },
);

// ── Tool: execute ──────────────────────────────────────────────────────

server.registerTool(
  "execute",
  {
    description:
      'Execute a query operation on the database. You MUST use the "check" tool first to validate the query before calling this tool',
    inputSchema: z.object({
      model: z.string().describe('The model name (e.g., "user", "post")'),
      operation: z
        .string()
        .describe('The operation name (e.g., "findMany", "create", "update")'),
      args: z
        .string()
        .describe(
          'The arguments as a JSON string (e.g., \'{"where":{"id":"abc"}}\')',
        ),
    }),
  },
  async ({ model, operation, args }) => {
    // Validate JSON
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      return {
        content: [
          { type: "text", text: `Error: Invalid JSON in args: ${args}` },
        ],
        isError: true,
      };
    }

    try {
      const result = await executeQuery(model, operation, parsedArgs);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Execution error: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Start Server ───────────────────────────────────────────────────────

const db = getDb();
const authMiddleware = new AuthMiddleware(db);

const app = createMcpExpressApp();
const transports: Map<string, NodeStreamableHTTPServerTransport> = new Map();

// Add JSON body parser and URL-encoded parser for OAuth form submissions
import express from "express";
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req: Request, res: Response, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Mount OAuth routes (login page, authorize, token, register, revoke, metadata)
app.use("/", authMiddleware.getRouter());

// MCP endpoint - protected by bearer auth
app.post(
  "/mcp",
  authMiddleware.getBearerAuthMiddleware(),
  async (req: Request & { auth?: AuthInfo }, res: Response) => {
    const userId = req.auth?.extra?.userId as string | undefined;

    const handle = async () => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        // Reuse existing transport for this session
        const transport = transports.get(sessionId)!;
        // Pass auth info to transport
        (req as any).auth = req.auth;
        await transport.handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New session: create transport and connect server
        const transport: NodeStreamableHTTPServerTransport =
          new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string): void => {
              transports.set(sid, transport);
            },
          });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        await server.connect(transport);
        // Pass auth info to transport
        (req as any).auth = req.auth;
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Invalid request: missing or invalid session ID, or not an initialize request",
          },
          id: null,
        });
      }
    };

    if (userId) {
      await userContext.run(userId, handle);
    } else {
      await handle();
    }
  },
);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    activeSessions: transports.size,
    timestamp: new Date().toISOString(),
  });
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
🚀 ZenStack MCP server running at: ${config.baseUrl}
📡 MCP endpoint: ${config.baseUrl}/mcp
🔐 OAuth endpoints:
   • Authorization: ${config.baseUrl}/oauth/authorize
   • Token:         ${config.baseUrl}/oauth/token
   • Register:      ${config.baseUrl}/oauth/register
   • Metadata:      ${config.baseUrl}/.well-known/oauth-authorization-server
   • Login Page:    ${config.baseUrl}/auth/login
  `);
});
