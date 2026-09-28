import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Artefactos del Authorization Server OAuth integrado (oidc-provider): sesiones,
 * interacciones, códigos, grants, refresh tokens y clientes registrados por DCR.
 * No contiene datos de negocio; los access tokens son JWT y no se almacenan.
 */
export const oauthArtifacts = pgTable("oauth_artifacts", {
  model: text("model").notNull(),
  id: text("id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  grantId: text("grant_id"),
  uid: text("uid"),
  userCode: text("user_code"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ columns: [table.model, table.id] }),
  grantIndex: index("oauth_artifacts_grant_idx").on(table.grantId),
  uidIndex: index("oauth_artifacts_uid_idx").on(table.model, table.uid),
  userCodeIndex: index("oauth_artifacts_user_code_idx").on(table.model, table.userCode),
  expiresIndex: index("oauth_artifacts_expires_idx").on(table.expiresAt),
}));
