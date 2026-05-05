import crypto from "crypto";
import bcrypt from "bcrypt";
import type { ClientContract } from "@zenstackhq/orm";
import type { SchemaType } from "../../zenstack/schema.js";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ClientsStore, type OAuthClientInfo } from "./ClientsStore.js";

export class PasswordAuthProvider {
  private _clientsStore: ClientsStore;
  private db: ClientContract<SchemaType, any>;

  constructor(db: ClientContract<SchemaType, any>) {
    this._clientsStore = new ClientsStore(db);
    this.db = db;

    this.initializeDefaultClient();
  }

  private async initializeDefaultClient() {
    try {
      await this._clientsStore.initialize();
    } catch (error) {
      console.error("Error initializing default client:", error);
    }
  }

  get clientsStore(): ClientsStore {
    return this._clientsStore;
  }

  /**
   * Begins the authorization flow — redirects to login page
   */
  getAuthorizationRedirectUrl(
    client: OAuthClientInfo,
    params: {
      state?: string;
      codeChallenge: string;
      redirectUri: string;
      scopes?: string[];
    },
    baseUrl: string,
  ): string {
    const loginUrl = new URL("/auth/login", baseUrl);
    loginUrl.searchParams.set("client_id", client.client_id);
    loginUrl.searchParams.set(
      "client_name",
      client.client_name || "Unknown Application",
    );
    if (params.state) {
      loginUrl.searchParams.set("state", params.state);
    }
    loginUrl.searchParams.set("code_challenge", params.codeChallenge);
    loginUrl.searchParams.set("redirect_uri", params.redirectUri);
    if (params.scopes && params.scopes.length > 0) {
      loginUrl.searchParams.set("scope", params.scopes.join(" "));
    }
    return loginUrl.toString();
  }

  /**
   * Handles the login form submission
   */
  async handleLogin(
    email: string,
    password: string,
    clientId: string,
    state: string,
    codeChallenge: string,
    redirectUri: string,
    scopes: string[],
  ): Promise<{ success: boolean; authCode?: string; error?: string }> {
    try {
      const user = await this.db.user.findUnique({
        where: { email },
        omit: { password: false },
      });

      if (!user) {
        return { success: false, error: "User not found" };
      }

      if (!user.password) {
        console.error(
          "Password field is null/undefined for user:",
          email,
        );
        return { success: false, error: "Password not accessible" };
      }

      // Validate password using bcrypt
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return { success: false, error: "Invalid password" };
      }

      // Generate authorization code
      const authCode = crypto.randomBytes(32).toString("hex");

      // Store authorization code in database
      await this.db.authorizationCode.create({
        data: {
          code: authCode,
          clientId,
          userId: user.id,
          codeChallenge,
          redirectUri,
          expiresAt: new Date(Date.now() + 600000), // 10 minutes
          scopes: JSON.stringify(scopes),
        },
      });

      return { success: true, authCode };
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, error: "Login failed" };
    }
  }

  /**
   * Returns the code challenge for verification
   */
  async challengeForAuthorizationCode(
    clientId: string,
    authorizationCode: string,
  ): Promise<string> {
    const authData = await this.db.authorizationCode.findUnique({
      where: { code: authorizationCode },
    });

    if (!authData || authData.clientId !== clientId) {
      throw new Error("Invalid authorization code");
    }

    if (Date.now() > new Date(authData.expiresAt).getTime()) {
      await this.db.authorizationCode.delete({
        where: { code: authorizationCode },
      });
      throw new Error("Authorization code expired");
    }

    return authData.codeChallenge;
  }

  /**
   * Exchanges authorization code for access token
   */
  async exchangeAuthorizationCode(
    clientId: string,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
  }> {
    const authData = await this.db.authorizationCode.findUnique({
      where: { code: authorizationCode },
    });

    if (!authData || authData.clientId !== clientId) {
      throw new Error("Invalid authorization code");
    }

    if (Date.now() > new Date(authData.expiresAt).getTime()) {
      await this.db.authorizationCode.delete({
        where: { code: authorizationCode },
      });
      throw new Error("Authorization code expired");
    }

    if (redirectUri && authData.redirectUri !== redirectUri) {
      throw new Error("Invalid redirect URI");
    }

    // Verify PKCE
    if (codeVerifier) {
      const challenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      if (challenge !== authData.codeChallenge) {
        throw new Error("Invalid code verifier");
      }
    }

    // Generate tokens
    const accessToken = crypto.randomBytes(32).toString("hex");
    const refreshToken = crypto.randomBytes(32).toString("hex");
    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const scopes: string[] = JSON.parse(authData.scopes);

    // Store tokens
    await this.db.accessToken.create({
      data: {
        token: accessToken,
        clientId,
        userId: authData.userId,
        scopes: authData.scopes,
        expiresAt,
      },
    });

    await this.db.refreshToken.create({
      data: {
        token: refreshToken,
        clientId,
        userId: authData.userId,
        scopes: authData.scopes,
        expiresAt: new Date(Date.now() + 86400 * 30 * 1000), // 30 days
      },
    });

    // Clean up authorization code
    await this.db.authorizationCode.delete({
      where: { code: authorizationCode },
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  /**
   * Exchanges refresh token for new access token
   */
  async exchangeRefreshToken(
    clientId: string,
    refreshToken: string,
    scopes?: string[],
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
  }> {
    const tokenData = await this.db.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!tokenData || tokenData.clientId !== clientId) {
      throw new Error("Invalid refresh token");
    }

    if (Date.now() > new Date(tokenData.expiresAt).getTime()) {
      await this.db.refreshToken.delete({
        where: { token: refreshToken },
      });
      throw new Error("Refresh token expired");
    }

    const finalScopes = scopes || (JSON.parse(tokenData.scopes) as string[]);

    // Generate new tokens
    const accessToken = crypto.randomBytes(32).toString("hex");
    const newRefreshToken = crypto.randomBytes(32).toString("hex");
    const expiresIn = 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await this.db.accessToken.create({
      data: {
        token: accessToken,
        clientId,
        userId: tokenData.userId,
        scopes: JSON.stringify(finalScopes),
        expiresAt,
      },
    });

    // Rotate refresh token
    await this.db.refreshToken.delete({
      where: { token: refreshToken },
    });
    await this.db.refreshToken.create({
      data: {
        token: newRefreshToken,
        clientId,
        userId: tokenData.userId,
        scopes: JSON.stringify(finalScopes),
        expiresAt: new Date(Date.now() + 86400 * 30 * 1000),
      },
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: finalScopes.join(" "),
    };
  }

  /**
   * Verifies access token and returns auth info
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = await this.db.accessToken.findUnique({
      where: { token },
    });

    if (!tokenData) {
      throw new Error("Invalid access token");
    }

    if (Date.now() > new Date(tokenData.expiresAt).getTime()) {
      await this.db.accessToken.delete({
        where: { token },
      });
      throw new Error("Access token expired");
    }

    return {
      token,
      clientId: tokenData.clientId,
      scopes: JSON.parse(tokenData.scopes) as string[],
      expiresAt: Math.floor(new Date(tokenData.expiresAt).getTime() / 1000),
      extra: {
        userId: tokenData.userId,
      },
    };
  }

  /**
   * Revokes access or refresh token
   */
  async revokeToken(clientId: string, token: string): Promise<void> {
    // Try to revoke as access token
    try {
      const accessTokenData = await this.db.accessToken.findUnique({
        where: { token },
      });
      if (accessTokenData && accessTokenData.clientId === clientId) {
        await this.db.accessToken.delete({
          where: { token },
        });
        return;
      }
    } catch {
      // ignore
    }

    // Try to revoke as refresh token
    try {
      const refreshTokenData = await this.db.refreshToken.findUnique({
        where: { token },
      });
      if (refreshTokenData && refreshTokenData.clientId === clientId) {
        await this.db.refreshToken.delete({
          where: { token },
        });
        return;
      }
    } catch {
      // ignore
    }

    // Token not found or doesn't belong to client - silently succeed per spec
  }
}
