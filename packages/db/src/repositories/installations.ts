import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { InstallationNotFoundError } from "../errors.js";
import { installations } from "../schema/common.js";

export interface EnsureInstallationInput {
  id?: string | undefined;
  slug: string;
  displayName: string;
}

export function createInstallationRepository(db: Database) {
  return {
    async getConfig(id: string): Promise<Record<string, unknown>> {
      const [row] = await db
        .select({ config: installations.config })
        .from(installations)
        .where(eq(installations.id, id))
        .limit(1);
      return (row?.config as Record<string, unknown>) ?? {};
    },

    /**
     * Escribe la config de una installation. Lanza `InstallationNotFoundError`
     * si el UPDATE no afecta a ninguna fila: un update de cero filas NO es un
     * guardado correcto.
     */
    async writeConfig(id: string, config: Record<string, unknown>): Promise<void> {
      const updated = await db
        .update(installations)
        .set({ config, updatedAt: new Date() })
        .where(eq(installations.id, id))
        .returning({ id: installations.id });
      if (updated.length === 0) throw new InstallationNotFoundError(id);
    },

    async exists(id: string): Promise<boolean> {
      const [row] = await db.select({ id: installations.id }).from(installations).where(eq(installations.id, id)).limit(1);
      return Boolean(row);
    },

    /**
     * Alta idempotente de la installation (infraestructura mínima, NO datos de
     * prueba). Si se aporta `id` se hace upsert por id; si no, por slug.
     */
    async ensure(input: EnsureInstallationInput) {
      const values = input.id ? { id: input.id, slug: input.slug, displayName: input.displayName } : { slug: input.slug, displayName: input.displayName };
      const [row] = await db
        .insert(installations)
        .values(values)
        .onConflictDoUpdate({
          target: input.id ? installations.id : installations.slug,
          set: { slug: input.slug, displayName: input.displayName, updatedAt: new Date() },
        })
        .returning({ id: installations.id, slug: installations.slug });
      return row!;
    },
  };
}
