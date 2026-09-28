import { and, eq, isNotNull, lt, or, gt, isNull } from "drizzle-orm";
import type { Database } from "../client.js";
import { oauthArtifacts } from "../schema/oauth.js";

type Payload = Record<string, unknown>;

/**
 * Almacén para el adaptador de oidc-provider. Cada `model` (Session, Grant,
 * RefreshToken, Client…) comparte la tabla; las filas caducadas no se devuelven
 * y se purgan periódicamente.
 */
export function createOAuthArtifactRepository(db: Database) {
  const live = () => or(isNull(oauthArtifacts.expiresAt), gt(oauthArtifacts.expiresAt, new Date()));
  const withConsumed = (row: { payload: Payload; consumedAt: Date | null } | undefined) => {
    if (!row) return undefined;
    return row.consumedAt ? { ...row.payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) } : row.payload;
  };
  return {
    async upsert(model: string, id: string, payload: Payload, expiresInSeconds?: number) {
      const values = {
        model, id, payload,
        grantId: typeof payload.grantId === "string" ? payload.grantId : null,
        uid: typeof payload.uid === "string" ? payload.uid : null,
        userCode: typeof payload.userCode === "string" ? payload.userCode : null,
        expiresAt: expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null,
      };
      await db.insert(oauthArtifacts).values(values).onConflictDoUpdate({
        target: [oauthArtifacts.model, oauthArtifacts.id],
        set: { payload: values.payload, grantId: values.grantId, uid: values.uid, userCode: values.userCode, expiresAt: values.expiresAt },
      });
    },
    async find(model: string, id: string) {
      const [row] = await db.select({ payload: oauthArtifacts.payload, consumedAt: oauthArtifacts.consumedAt }).from(oauthArtifacts).where(and(eq(oauthArtifacts.model, model), eq(oauthArtifacts.id, id), live())).limit(1);
      return withConsumed(row);
    },
    async findByUid(model: string, uid: string) {
      const [row] = await db.select({ payload: oauthArtifacts.payload, consumedAt: oauthArtifacts.consumedAt }).from(oauthArtifacts).where(and(eq(oauthArtifacts.model, model), eq(oauthArtifacts.uid, uid), live())).limit(1);
      return withConsumed(row);
    },
    async findByUserCode(model: string, userCode: string) {
      const [row] = await db.select({ payload: oauthArtifacts.payload, consumedAt: oauthArtifacts.consumedAt }).from(oauthArtifacts).where(and(eq(oauthArtifacts.model, model), eq(oauthArtifacts.userCode, userCode), live())).limit(1);
      return withConsumed(row);
    },
    async consume(model: string, id: string) {
      await db.update(oauthArtifacts).set({ consumedAt: new Date() }).where(and(eq(oauthArtifacts.model, model), eq(oauthArtifacts.id, id)));
    },
    async destroy(model: string, id: string) {
      await db.delete(oauthArtifacts).where(and(eq(oauthArtifacts.model, model), eq(oauthArtifacts.id, id)));
    },
    /** Revoca todo lo emitido bajo un grant (refresh tokens, códigos…), en cualquier modelo. */
    async revokeByGrantId(grantId: string) {
      await db.delete(oauthArtifacts).where(eq(oauthArtifacts.grantId, grantId));
    },
    async purgeExpired() {
      const deleted = await db.delete(oauthArtifacts).where(and(isNotNull(oauthArtifacts.expiresAt), lt(oauthArtifacts.expiresAt, new Date()))).returning({ id: oauthArtifacts.id });
      return deleted.length;
    },
    /** Revocación total de conexiones OAuth (no borra clientes registrados). */
    async revokeAllGrants() {
      const deleted = await db.delete(oauthArtifacts).where(or(eq(oauthArtifacts.model, "Grant"), eq(oauthArtifacts.model, "RefreshToken"), eq(oauthArtifacts.model, "Session"), eq(oauthArtifacts.model, "AuthorizationCode"))).returning({ id: oauthArtifacts.id });
      return deleted.length;
    },
  };
}

export type OAuthArtifactRepository = ReturnType<typeof createOAuthArtifactRepository>;
