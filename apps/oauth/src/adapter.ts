import type { Adapter, AdapterPayload } from "oidc-provider";
import type { OAuthArtifactRepository } from "@quotes/db";

/** Adaptador de persistencia de oidc-provider sobre PostgreSQL (tabla oauth_artifacts). */
export function createAdapterFactory(store: OAuthArtifactRepository) {
  return class PostgresAdapter implements Adapter {
    constructor(private readonly model: string) {}
    async upsert(id: string, payload: AdapterPayload, expiresIn: number) {
      await store.upsert(this.model, id, payload as Record<string, unknown>, expiresIn);
    }
    async find(id: string) {
      return (await store.find(this.model, id)) as AdapterPayload | undefined;
    }
    async findByUid(uid: string) {
      return (await store.findByUid(this.model, uid)) as AdapterPayload | undefined;
    }
    async findByUserCode(userCode: string) {
      return (await store.findByUserCode(this.model, userCode)) as AdapterPayload | undefined;
    }
    async consume(id: string) {
      await store.consume(this.model, id);
    }
    async destroy(id: string) {
      await store.destroy(this.model, id);
    }
    async revokeByGrantId(grantId: string) {
      await store.revokeByGrantId(grantId);
    }
  };
}
