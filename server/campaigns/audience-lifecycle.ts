import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaignExecutionEvents,
  campaigns,
  messageThreads,
  outboxJobs,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";

/**
 * Stops every future touch for one customer. The actual message history is kept,
 * but queued and not-yet-sent messages are cancelled and later campaign steps no
 * longer select this audience member.
 */
export const stopCampaignAudienceForCustomer = async (input: {
  workspaceId: string;
  customerId: string;
  reason: "客户回复" | "创建商机" | "退订" | "退信" | "投诉";
}) => {
  const now = Date.now();
  const members = await db
    .select()
    .from(campaignAudienceMembers)
    .where(
      and(
        eq(campaignAudienceMembers.workspaceId, input.workspaceId),
        eq(campaignAudienceMembers.customerId, input.customerId),
        inArray(campaignAudienceMembers.status, ["pending", "queued", "sent", "manual_task", "replied"]),
      ),
    );
  if (!members.length) return { stopped: 0, cancelledJobs: 0 };

  const campaignIds = [...new Set(members.map((member) => member.campaignId))];
  const threads = await db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.workspaceId, input.workspaceId),
        eq(messageThreads.customerId, input.customerId),
        inArray(messageThreads.campaignId, campaignIds),
      ),
    );
  const threadIds = threads.map((thread) => thread.id);
  let cancelledJobs = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(campaignAudienceMembers)
      .set({ status: "stopped", stopReason: input.reason, lastEventAt: now, updatedAt: now })
      .where(inArray(campaignAudienceMembers.id, members.map((member) => member.id)));
    if (threadIds.length) {
      const pendingJobs = await tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.workspaceId, input.workspaceId),
            inArray(outboxJobs.threadId, threadIds),
            inArray(outboxJobs.status, ["queued", "awaiting_configuration"]),
          ),
        );
      cancelledJobs = pendingJobs.length;
      if (pendingJobs.length)
        await tx
          .update(outboxJobs)
          .set({ status: "cancelled", lastError: `已因${input.reason}停止后续触达。`, completedAt: now, updatedAt: now })
          .where(inArray(outboxJobs.id, pendingJobs.map((job) => job.id)));
    }
    await tx.update(campaigns).set({ updatedAt: now }).where(inArray(campaigns.id, campaignIds));
    await tx.insert(campaignExecutionEvents).values(
      campaignIds.map((campaignId) => ({
        id: createId("cev"),
        workspaceId: input.workspaceId,
        campaignId,
        eventType: "audience_stopped",
        status: "completed",
        recipientCount: members.filter((member) => member.campaignId === campaignId).length,
        metadataJson: JSON.stringify({ customerId: input.customerId, reason: input.reason, cancelledJobs }),
        createdAt: now,
      })),
    );
  });
  return { stopped: members.length, cancelledJobs };
};
