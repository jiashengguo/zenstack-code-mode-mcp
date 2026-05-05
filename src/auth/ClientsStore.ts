import crypto from "crypto";
import type { ClientContract } from "@zenstackhq/orm";
import type { SchemaType } from "../../zenstack/schema.js";

export interface OAuthClientInfo {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope?: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
}

/**
 * Client store backed by ZenStack v3 database with in-memory cache
 */
export class ClientsStore {
  private db: ClientContract<SchemaType, any>;
  private clients = new Map<string, OAuthClientInfo>();
  private initialized = false;

  constructor(db: ClientContract<SchemaType, any>) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log("Loading OAuth clients from database...");
      const dbClients = await this.db.oAuthClient.findMany();

      for (const client of dbClients) {
        const clientInfo: OAuthClientInfo = {
          client_id: client.clientId,
          client_secret: client.clientSecret ?? undefined,
          client_name: client.clientName ?? undefined,
          redirect_uris: JSON.parse(client.redirectUris),
          grant_types: JSON.parse(client.grantTypes),
          response_types: JSON.parse(client.responseTypes),
          scope: client.scope ?? undefined,
          client_id_issued_at: client.clientIdIssuedAt,
          client_secret_expires_at: client.clientSecretExpiresAt,
        };
        this.clients.set(client.clientId, clientInfo);
      }

      console.log(`Loaded ${dbClients.length} OAuth clients from database`);
      this.initialized = true;
    } catch (error) {
      console.error("Error loading clients from database:", error);
      this.initialized = true;
    }
  }

  getClient(clientId: string): OAuthClientInfo | undefined {
    if (!this.initialized) {
      console.warn(
        "Clients not initialized yet, returning undefined for client:",
        clientId,
      );
      return undefined;
    }
    return this.clients.get(clientId);
  }

  async registerClient(
    client: Partial<OAuthClientInfo>,
  ): Promise<OAuthClientInfo> {
    const clientInfo: OAuthClientInfo = {
      client_id: client.client_id || crypto.randomUUID(),
      client_secret:
        client.client_secret || crypto.randomBytes(32).toString("hex"),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris || [],
      grant_types: client.grant_types || ["authorization_code"],
      response_types: client.response_types || ["code"],
      scope: client.scope,
      client_id_issued_at:
        client.client_id_issued_at || Math.floor(Date.now() / 1000),
      client_secret_expires_at:
        client.client_secret_expires_at ||
        Math.floor(Date.now() / 1000) + 86400 * 365,
    };

    // Store in memory cache
    this.clients.set(clientInfo.client_id, clientInfo);

    // Persist to database
    try {
      const existing = await this.db.oAuthClient
        .findUnique({
          where: { clientId: clientInfo.client_id },
        })
        .catch(() => null);

      if (existing) {
        await this.db.oAuthClient.update({
          where: { clientId: clientInfo.client_id },
          data: {
            clientSecret: clientInfo.client_secret,
            clientName: clientInfo.client_name,
            redirectUris: JSON.stringify(clientInfo.redirect_uris),
            grantTypes: JSON.stringify(clientInfo.grant_types),
            responseTypes: JSON.stringify(clientInfo.response_types),
            scope: clientInfo.scope,
            clientIdIssuedAt: clientInfo.client_id_issued_at,
            clientSecretExpiresAt: clientInfo.client_secret_expires_at,
          },
        });
      } else {
        await this.db.oAuthClient.create({
          data: {
            clientId: clientInfo.client_id,
            clientSecret: clientInfo.client_secret,
            clientName: clientInfo.client_name,
            redirectUris: JSON.stringify(clientInfo.redirect_uris),
            grantTypes: JSON.stringify(clientInfo.grant_types),
            responseTypes: JSON.stringify(clientInfo.response_types),
            scope: clientInfo.scope,
            clientIdIssuedAt: clientInfo.client_id_issued_at,
            clientSecretExpiresAt: clientInfo.client_secret_expires_at,
          },
        });
      }
    } catch (error) {
      console.error("Error persisting client to database:", error);
      this.clients.delete(clientInfo.client_id);
      throw error;
    }

    return clientInfo;
  }
}
