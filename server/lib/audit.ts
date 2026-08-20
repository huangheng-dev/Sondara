import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import { createId } from "./ids.js";

export const audit = (
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown = {},
) => {
  db.insert(auditLogs)
    .values({
      id: createId("aud"),
      workspaceId,
      actorUserId,
      action,
      entityType,
      entityId,
      metadata: JSON.stringify(metadata),
      createdAt: Date.now(),
    })
    .run();
};
