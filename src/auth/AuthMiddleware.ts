import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { ClientContract } from "@zenstackhq/orm";
import type { SchemaType } from "../../zenstack/schema.js";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { PasswordAuthProvider } from "./PasswordAuthProvider.js";
import { config } from "../config.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class AuthMiddleware {
  private authProvider: PasswordAuthProvider;
  private authRouter: express.Router = express.Router();

  constructor(db: ClientContract<SchemaType, any>) {
    this.authProvider = new PasswordAuthProvider(db);
    this.setupRouter();
  }

  private setupRouter() {
    // Serve the login page
    this.authRouter.get("/auth/login", (_req: Request, res: Response) => {
      try {
        const templatePath = join(__dirname, "login.html");
        const template = readFileSync(templatePath, "utf-8");
        res.setHeader("Content-Type", "text/html");
        res.send(template);
      } catch (error) {
        console.error("Error serving login page:", error);
        res.status(500).send(`
<!DOCTYPE html>
<html>
<head><title>Login Error</title></head>
<body>
    <h1>Login Unavailable</h1>
    <p>The login form could not be loaded. Please contact the administrator.</p>
</body>
</html>`);
      }
    });

    // Handle login form submission
    this.authRouter.post(
      "/auth/login",
      async (req: Request, res: Response) => {
        await this.handleLogin(req, res);
      },
    );

    // OAuth2 Authorization endpoint
    this.authRouter.get(
      "/oauth/authorize",
      async (req: Request, res: Response) => {
        try {
          const clientId = req.query.client_id as string;
          const responseType = req.query.response_type as string;
          const redirectUri = req.query.redirect_uri as string;
          const state = req.query.state as string | undefined;
          const codeChallenge = req.query.code_challenge as string;
          const scope = req.query.scope as string | undefined;

          if (!clientId || !redirectUri || !codeChallenge) {
            res.status(400).json({
              error: "invalid_request",
              error_description: "Missing required parameters",
            });
            return;
          }

          if (responseType && responseType !== "code") {
            res.status(400).json({
              error: "unsupported_response_type",
              error_description: "Only 'code' response type is supported",
            });
            return;
          }

          // Look up or auto-register the client
          let client = this.authProvider.clientsStore.getClient(clientId);
          if (!client) {
            // Auto-register the client (dynamic registration)
            client = await this.authProvider.clientsStore.registerClient({
              client_id: clientId,
              redirect_uris: [redirectUri],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              scope: scope || "read write",
            });
          }

          // Redirect to login page
          const loginUrl =
            this.authProvider.getAuthorizationRedirectUrl(
              client,
              {
                state,
                codeChallenge,
                redirectUri,
                scopes: scope ? scope.split(" ") : [],
              },
              config.baseUrl,
            );

          res.redirect(loginUrl);
        } catch (error) {
          console.error("Authorization error:", error);
          res.status(500).json({
            error: "server_error",
            error_description: "Authorization server error",
          });
        }
      },
    );

    // OAuth2 Token endpoint
    this.authRouter.post(
      "/oauth/token",
      async (req: Request, res: Response) => {
        try {
          const grantType = req.body.grant_type;
          const clientId = req.body.client_id;

          if (!clientId) {
            res.status(400).json({
              error: "invalid_request",
              error_description: "Missing client_id",
            });
            return;
          }

          if (grantType === "authorization_code") {
            const code = req.body.code;
            const codeVerifier = req.body.code_verifier;
            const redirectUri = req.body.redirect_uri;

            if (!code) {
              res.status(400).json({
                error: "invalid_request",
                error_description: "Missing authorization code",
              });
              return;
            }

            const tokens =
              await this.authProvider.exchangeAuthorizationCode(
                clientId,
                code,
                codeVerifier,
                redirectUri,
              );

            res.json(tokens);
          } else if (grantType === "refresh_token") {
            const refreshToken = req.body.refresh_token;
            const scope = req.body.scope;

            if (!refreshToken) {
              res.status(400).json({
                error: "invalid_request",
                error_description: "Missing refresh_token",
              });
              return;
            }

            const tokens =
              await this.authProvider.exchangeRefreshToken(
                clientId,
                refreshToken,
                scope ? scope.split(" ") : undefined,
              );

            res.json(tokens);
          } else {
            res.status(400).json({
              error: "unsupported_grant_type",
              error_description: `Unsupported grant type: ${grantType}`,
            });
          }
        } catch (error) {
          console.error("Token error:", error);
          const message =
            error instanceof Error ? error.message : "Token exchange failed";
          res.status(400).json({
            error: "invalid_grant",
            error_description: message,
          });
        }
      },
    );

    // OAuth2 Client registration endpoint
    this.authRouter.post(
      "/oauth/register",
      async (req: Request, res: Response) => {
        try {
          const client =
            await this.authProvider.clientsStore.registerClient(req.body);
          res.status(201).json(client);
        } catch (error) {
          console.error("Registration error:", error);
          res.status(500).json({
            error: "server_error",
            error_description: "Client registration failed",
          });
        }
      },
    );

    // OAuth2 Token revocation endpoint
    this.authRouter.post(
      "/oauth/revoke",
      async (req: Request, res: Response) => {
        try {
          const { token, client_id } = req.body;
          if (token && client_id) {
            await this.authProvider.revokeToken(client_id, token);
          }
          res.status(200).json({});
        } catch (error) {
          console.error("Revocation error:", error);
          res.status(500).json({
            error: "server_error",
            error_description: "Token revocation failed",
          });
        }
      },
    );

    // OAuth metadata (RFC 8414)
    this.authRouter.get(
      "/.well-known/oauth-authorization-server",
      (_req: Request, res: Response) => {
        res.json({
          issuer: config.baseUrl,
          authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
          token_endpoint: `${config.baseUrl}/oauth/token`,
          registration_endpoint: `${config.baseUrl}/oauth/register`,
          revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
          scopes_supported: ["read", "write"],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      },
    );

    // Protected resource metadata
    this.authRouter.get(
      "/.well-known/oauth-protected-resource",
      (_req: Request, res: Response) => {
        res.json({
          resource: config.baseUrl,
          authorization_servers: [config.baseUrl],
          scopes_supported: ["read", "write"],
          bearer_methods_supported: ["header"],
        });
      },
    );
  }

  private async handleLogin(req: Request, res: Response) {
    try {
      const {
        email,
        password,
        client_id,
        state,
        code_challenge,
        redirect_uri,
        scopes,
      } = req.body;

      if (
        !email ||
        !password ||
        !client_id ||
        !code_challenge ||
        !redirect_uri
      ) {
        res.status(400).json({
          success: false,
          error: "Missing required parameters",
        });
        return;
      }

      const scopesArray = scopes
        ? scopes.split(" ").filter(Boolean)
        : [];

      const result = await this.authProvider.handleLogin(
        email,
        password,
        client_id,
        state || "",
        code_challenge,
        redirect_uri,
        scopesArray,
      );

      if (result.success && result.authCode) {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set("code", result.authCode);
        if (state) {
          redirectUrl.searchParams.set("state", state);
        }

        res.json({
          success: true,
          redirectUrl: redirectUrl.toString(),
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || "Invalid username or password",
        });
      }
    } catch (error) {
      console.error("Login handler error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Bearer token verification middleware
   */
  public getBearerAuthMiddleware() {
    return async (
      req: Request & { auth?: AuthInfo },
      res: Response,
      next: NextFunction,
    ) => {
      try {
        let token: string | undefined;

        // Try Authorization header first
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }

        // Fall back to query parameter (for SSE compatibility)
        if (!token && req.query.access_token) {
          token = req.query.access_token as string;
        }

        if (!token) {
          // Return 401 with proper WWW-Authenticate header per MCP spec
          res.setHeader(
            "WWW-Authenticate",
            `Bearer realm="MCP Server", resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
          );
          res.status(401).json({
            error: "unauthorized",
            error_description: "Valid access token required",
          });
          return;
        }

        const authInfo = await this.authProvider.verifyAccessToken(token);
        req.auth = authInfo;
        next();
      } catch (error) {
        console.error("Auth middleware error:", error);
        res.setHeader(
          "WWW-Authenticate",
          `Bearer realm="MCP Server", resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
        );
        res.status(401).json({
          error: "invalid_token",
          error_description: "Authentication failed",
        });
      }
    };
  }

  public getRouter() {
    return this.authRouter;
  }

  public getProvider() {
    return this.authProvider;
  }
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}
