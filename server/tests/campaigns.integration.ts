import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaignContentLinks,
  campaignExecutionEvents,
  campaigns,
  campaignSteps,
  messageEntries,
  outboxJobs,
  users,
} from "../db/schema.js";

const run = async () => {
  const app = await buildApp();
  const email = `campaign-${Date.now()}@integration.local`;
  let userId = "";
  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        displayName: "活动集成测试",
        email,
        password: "Campaign@2026",
      },
    });
    assert.equal(register.statusCode, 201, register.body);
    userId = register.json().user.id;
    const cookie = register.headers["set-cookie"];
    assert.ok(cookie);
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie };

    const customer = await app.inject({
      method: "POST",
      url: "/api/customers",
      headers,
      payload: {
        company: "活动目标客户有限公司",
        region: "上海",
        industry: "工业设备",
        score: 92,
        signal: "新建产线",
      },
    });
    assert.equal(customer.statusCode, 201, customer.body);
    const content = await app.inject({
      method: "POST",
      url: "/api/content/assets",
      headers,
      payload: {
        title: "活动触达邮件",
        contentType: "首次触达邮件",
        channel: "邮件",
        body: "您好，我们整理了 3 个验证案例，如有需要可以回复获取清单。",
        targetMarket: "工业设备",
        customerRole: "采购负责人",
        customerSignal: "新建产线",
      },
    });
    assert.equal(content.statusCode, 201, content.body);

    const scheduledAt = Date.now() + 86_400_000;
    const created = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers,
      payload: {
        name: "华东新建产线触达",
        market: "华东工业设备",
        audienceLabel: "华东新建产线企业",
        channel: "邮件",
        stopRule: "收到回复",
        startAt: scheduledAt,
        contentAssetId: content.json().id,
        audienceCustomerIds: [customer.json().id],
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const campaign = created.json();
    assert.equal(campaign.audienceCount, 1);
    assert.equal(campaign.contentIds[0], content.json().id);
    assert.equal(campaign.steps.length, 1);

    const thread = await app.inject({
      method: "POST",
      url: "/api/inbox/threads",
      headers,
      payload: {
        customerId: customer.json().id,
        campaignId: campaign.id,
        subject: "活动联系人",
        channel: "邮件",
        contact: {
          name: "赵采购",
          company: "活动目标客户有限公司",
          primaryChannel: "邮件",
          email: "campaign-buyer@example.com",
        },
      },
    });
    assert.equal(thread.statusCode, 201, thread.body);
    const rejectedExecution = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/steps/${campaign.steps[0].id}/execute`,
      headers,
      payload: {},
    });
    assert.equal(rejectedExecution.statusCode, 400, rejectedExecution.body);
    const execution = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/steps/${campaign.steps[0].id}/execute`,
      headers,
      payload: { confirmation: true },
    });
    assert.equal(execution.statusCode, 202, execution.body);
    assert.equal(execution.json().recipientCount, 1);
    assert.equal(execution.json().awaitingConfiguration, 1);

    const activated = await app.inject({
      method: "PATCH",
      url: `/api/campaigns/${campaign.id}`,
      headers,
      payload: { status: "运行中" },
    });
    assert.equal(activated.statusCode, 200, activated.body);
    assert.equal(activated.json().status, "运行中");
    assert.equal(activated.json().market, "华东工业设备");
    assert.equal(activated.json().channel, "邮件");

    const secondStep = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaign.id}/steps`,
      headers,
      payload: {
        name: "第二轮案例触达",
        channel: "邮件",
        contentAssetId: content.json().id,
        scheduledAt: scheduledAt + 2 * 86_400_000,
      },
    });
    assert.equal(secondStep.statusCode, 201, secondStep.body);
    assert.equal(secondStep.json().steps.length, 2);

    const schedule = await app.inject({
      method: "GET",
      url: "/api/campaigns/schedule",
      headers,
    });
    assert.equal(schedule.statusCode, 200, schedule.body);
    assert.equal(schedule.json().total, 2);

    const listed = await app.inject({
      method: "GET",
      url: "/api/campaigns?q=华东&pageSize=20",
      headers,
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().total, 1);
    assert.equal(listed.json().items[0].nextStep.name, "第二轮案例触达");

    assert.equal(
      (await db.$first(db.select().from(campaigns).where(eq(campaigns.id, campaign.id))))
        ?.status,
      "运行中",
    );
    assert.equal(
      (await db
                .select()
                .from(campaignAudienceMembers)
                .where(eq(campaignAudienceMembers.campaignId, campaign.id))).length,
      1,
    );
    assert.equal(
      (await db
                .select()
                .from(campaignContentLinks)
                .where(eq(campaignContentLinks.campaignId, campaign.id))).length,
      1,
    );
    assert.equal(
      (await db
                .select()
                .from(campaignSteps)
                .where(eq(campaignSteps.campaignId, campaign.id))).length,
      2,
    );
    assert.equal(
      (await db
                .select()
                .from(outboxJobs)
                .where(eq(outboxJobs.workspaceId, register.json().workspace.id))).length,
      1,
    );
    assert.equal(
      (await db
                .select()
                .from(messageEntries)
                .where(eq(messageEntries.status, "confirmed")))
        .filter((item) => item.workspaceId === register.json().workspace.id)
        .length,
      1,
    );
    assert.ok(
      (await db.$first(db
                .select()
                .from(campaignExecutionEvents)
                .where(eq(campaignExecutionEvents.campaignId, campaign.id)))),
    );
    console.log(
      "Campaigns integration passed: audience, content, schedule, status and execution events verified.",
    );
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await app.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
