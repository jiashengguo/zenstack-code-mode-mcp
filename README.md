# ZenStack Code Mode MCP Server with Authorization

This repository contains a sample implementation of a remote MCP server with authentication and authorization for ZenStack v3. It demonstrates how to set up an MCP server that can be accessed remotely, with user authentication and role-based access control.

## Features

- Remote MCP server accessible with credential Authentication support
- ZenStack query API exposed through the MCP server using Code Mode with only 3 tools to improve context efficiency

## Tools

- `schema`

  Get the complete zmodel schema, available query APIs, and rules for complex query patterns.

- `check`

  Validate a query function call before execution. Performs TypeScript type checking to ensure the operation and arguments are valid for the given model.

- `execute`

  Execute a query operation on the database. Use the "check" tool first to validate the call, then execute it.

## Quick Start

1. **Install dependencies**:

   ```bash
   pnpm install
   ```

2. **Start the server**:

   ```bash
   pnpm run dev
   ```

## Testing the MCP Server

### MCP Inspector

The easiest way to test the MCP server is to run

```bash
npx @modelcontextprotocol/inspector
```

### MCP Client

If your chosen MCP client supports remote OAuth2 MCP server like Cursor, Github Copilot, you can directly connect with the following configuration:

```json
{
  "servers": {
    "blog": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

If the mcp client doesn't support oAuth or only support https, you can use `mcp-remote` proxy to workaround it like for Claude Desktop:

```json
{
  "servers": {
    "blog": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```
