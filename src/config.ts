// Configuration settings for the MCP server
export const config = {
  // Server base URL - defaults to localhost:3000 if not specified in environment
  baseUrl: process.env.BASE_URL || "http://localhost:3000",

  // Port - can be overridden via environment
  port: parseInt(process.env.PORT || "3000"),
} as const;
