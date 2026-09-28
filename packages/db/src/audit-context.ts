import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditActor { actorType: "user" | "ai" | "system" | "worker"; subject: string }
const context = new AsyncLocalStorage<AuditActor>();
export function withAuditActor<T>(actor: AuditActor, run: () => T): T { return context.run(actor, run); }
export function auditActor() {
  const actor = context.getStore() ?? { actorType: "system" as const, subject: "system" };
  return { actorType: actor.actorType, metadata: { subject: actor.subject } };
}
