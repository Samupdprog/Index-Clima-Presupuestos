import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import { createDb, createOAuthArtifactRepository, oauthArtifacts } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

describe("OAuth artifacts against PostgreSQL", () => {
  const { db, pool } = createDb(databaseUrl);
  const store = createOAuthArtifactRepository(db);
  const run = `TEST-${randomUUID()}`;
  const id = (name: string) => `${run}-${name}`;
  afterAll(async () => {
    await db.delete(oauthArtifacts).where(like(oauthArtifacts.id, `${run}%`));
    await pool.end();
  });

  it("upserts, finds by id/uid and marks consumption", async () => {
    await store.upsert("Interaction", id("i1"), { uid: id("uid1"), kind: "Interaction" }, 600);
    expect(await store.find("Interaction", id("i1"))).toMatchObject({ uid: id("uid1") });
    expect(await store.findByUid("Interaction", id("uid1"))).toMatchObject({ kind: "Interaction" });
    await store.upsert("Interaction", id("i1"), { uid: id("uid1"), kind: "Interaction", updated: true }, 600);
    expect(await store.find("Interaction", id("i1"))).toMatchObject({ updated: true });
    await store.consume("Interaction", id("i1"));
    expect((await store.find("Interaction", id("i1")))?.consumed).toEqual(expect.any(Number));
  });
  it("hides expired rows and purges them", async () => {
    await store.upsert("AuthorizationCode", id("expired"), { grantId: id("g0") }, 1);
    await db.update(oauthArtifacts).set({ expiresAt: new Date(Date.now() - 1000) }).where(like(oauthArtifacts.id, id("expired")));
    expect(await store.find("AuthorizationCode", id("expired"))).toBeUndefined();
    expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);
  });
  it("revokes every artifact of a grant across models", async () => {
    await store.upsert("RefreshToken", id("rt"), { grantId: id("g1") }, 3600);
    await store.upsert("AuthorizationCode", id("code"), { grantId: id("g1") }, 60);
    await store.upsert("RefreshToken", id("other"), { grantId: id("g2") }, 3600);
    await store.revokeByGrantId(id("g1"));
    expect(await store.find("RefreshToken", id("rt"))).toBeUndefined();
    expect(await store.find("AuthorizationCode", id("code"))).toBeUndefined();
    expect(await store.find("RefreshToken", id("other"))).toBeDefined();
    await store.destroy("RefreshToken", id("other"));
    expect(await store.find("RefreshToken", id("other"))).toBeUndefined();
  });
});
