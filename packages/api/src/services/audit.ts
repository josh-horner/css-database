import { schema, type DbOrTx } from "@css/db";

export async function audit(
  db: DbOrTx,
  actor: { type: "staff" | "customer" | "employee" | "device" | "system" | "ai"; id: string | null },
  entity: string,
  entityId: string,
  action: string,
  before: unknown = null,
  after: unknown = null,
) {
  await db.insert(schema.auditEvents).values({ actorType: actor.type, actorId: actor.id, entity, entityId, action, before, after });
}
