import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaigns,
  customers,
  inboxContacts,
  messageEntries,
  messageThreads,
  outboxJobs,
  outboundChannelConnections,
  tasks,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { stopCampaignAudienceForCustomer } from "../campaigns/audience-lifecycle.js";
import { decryptSecret } from "../lib/secret-vault.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from "../lib/leader-lock.js";
import { recordCustomerTouchpoint } from '../leads/touchpoints.js';
import { applyInboundIntentAutomation } from './intent-automation.js';
import { cancelPendingAutomatedMessagesForThread } from '../outbox/automation-stop.js';
import { persistReplySuggestion } from '../automation/closed-loop.js';

export type ImapAccount = {
  connectionId: string;
  workspaceId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type ParsedMail = {
  messageId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  date: number;
};

const STATE_PATH = resolve(process.cwd(), "data", "imap-state.json");
const processedMessageIds = new Set<string>();

const stripBrackets = (value: string | null | undefined) =>
  (value ?? "").replace(/[<>]/g, "").trim();

const normalizeEmail = (value: string) =>
  value.trim().toLowerCase().replace(/^.*<|>.*$/g, "");

const FREE_MAIL_DOMAINS = /^(?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|qq|163|126|sina|protonmail|proton|gmx|aol)\./i;
const INQUIRY_TERMS = /(?:询价|报价|采购|合作|样品|目录|资料|演示|试用|项目|供应商|价格|交期|inquiry|enquiry|quotation|quote|rfq|rfi|price|pricing|purchase|procurement|supplier|catalog|brochure|sample|demo|trial|project|partnership|distributor)/i;
const BULK_MAIL_TERMS = /(?:unsubscribe|退订|newsletter|digest|no[-_.]?reply|notification|验证码|verification code|password reset)/i;

const emailDomain = (email: string) => email.split('@')[1]?.toLowerCase().replace(/^www\./, '') ?? '';
const shouldCreateInboundCustomer = (mail: ParsedMail, fromAddress: string) => {
  const domain = emailDomain(fromAddress);
  const content = `${mail.subject}\n${mail.text}`;
  if (!domain || BULK_MAIL_TERMS.test(content) || /^(?:no[-_.]?reply|notifications?)@/i.test(fromAddress)) return false;
  return !FREE_MAIL_DOMAINS.test(domain) || INQUIRY_TERMS.test(content);
};

const inboundCompanyName = (mail: ParsedMail, fromAddress: string) => {
  const domain = emailDomain(fromAddress);
  if (domain && !FREE_MAIL_DOMAINS.test(domain)) return domain;
  const name = mail.fromName?.split(/[<>\[\]()]/)[0]?.trim()?.replace(/^["']+|["']+$/g, '');
  return name || fromAddress;
};

const ensureInboundCustomer = async (account: ImapAccount, contactId: string, mail: ParsedMail, fromAddress: string, now: number) => {
  const contact = await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.id, contactId), eq(inboxContacts.workspaceId, account.workspaceId))));
  if (!contact || contact.customerId) return contact?.customerId ?? null;
  if (!shouldCreateInboundCustomer(mail, fromAddress)) return null;

  const company = inboundCompanyName(mail, fromAddress).slice(0, 160);
  let customer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, account.workspaceId), sql`lower(${customers.company}) = ${company.toLowerCase()}`)));
  if (!customer) {
    const customerId = createId('cus');
    await db.insert(customers).values({
      id: customerId,
      workspaceId: account.workspaceId,
      company,
      region: contact.region || '待补全',
      industry: '待补全',
      score: 90,
      confidence: emailDomain(fromAddress) && !FREE_MAIL_DOMAINS.test(emailDomain(fromAddress)) ? 86 : 68,
      signal: '主动邮件询盘',
      source: '邮件询盘 · IMAP',
      stage: '待验证',
      contacts: 0,
      validContacts: 0,
      interaction: mail.subject || '收到新的邮件询盘',
      nextAction: '核验询盘需求并在 24 小时内回复',
      dueAt: now + 86_400_000,
      createdAt: now,
      updatedAt: now,
    });
    customer = await db.$first(db.select().from(customers).where(eq(customers.id, customerId)));
  }
  if (!customer) return null;

  await db.transaction(async tx => {
    await tx.update(inboxContacts).set({ customerId: customer.id, company: customer.company, updatedAt: now }).where(eq(inboxContacts.id, contactId));
    const existingTask = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, account.workspaceId), eq(tasks.customerId, customer.id), eq(tasks.status, 'open'), eq(tasks.source, '邮件询盘 · IMAP'))).limit(1);
    if (!existingTask.length) await tx.insert(tasks).values({
      id: createId('tsk'), workspaceId: account.workspaceId, customerId: customer.id,
      title: `回复邮件询盘：${customer.company}`, priority: '高', dueAt: now + 86_400_000,
      dueLabel: '24 小时内', company: customer.company, nextAction: '核验需求、联系人与企业信息后回复',
      impact: mail.subject || mail.text.slice(0, 240), source: '邮件询盘 · IMAP', status: 'open', createdAt: now, updatedAt: now,
    });
    const counts = await tx.select({ total: sql<number>`count(*)`, valid: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, account.workspaceId), eq(inboxContacts.customerId, customer.id)));
    await tx.update(customers).set({ contacts: counts[0]?.total ?? 0, validContacts: counts[0]?.valid ?? 0, signal: '主动邮件询盘', interaction: mail.subject || customer.interaction, nextAction: '核验询盘需求并在 24 小时内回复', dueAt: now + 86_400_000, archivedAt: null, updatedAt: now }).where(eq(customers.id, customer.id));
  });
  await recordCustomerTouchpoint({
    workspaceId: account.workspaceId,
    customerId: customer.id,
    contactId,
    eventType: 'email_inquiry',
    source: 'email-inquiry',
    medium: 'email',
    externalId: mail.messageId,
    metadata: { connectionId: account.connectionId, subject: mail.subject },
    occurredAt: mail.date,
  });
  return customer.id;
};

const deriveImapHost = (smtpHost: string) => {
  if (config.imapHost) return config.imapHost;
  const host = smtpHost.toLowerCase().trim();
  if (host.startsWith("smtp.")) return "imap." + host.slice(5);
  if (host.startsWith("smtp-")) return "imap-" + host.slice(5);
  if (host.startsWith("mail.")) return host;
  return host;
};

const loadState = (): Record<string, number> => {
  try {
    if (existsSync(STATE_PATH))
      return JSON.parse(readFileSync(STATE_PATH, "utf8")) as Record<
        string,
        number
      >;
  } catch {
    /* ignore corrupt state */
  }
  return {};
};

const saveState = (state: Record<string, number>) => {
  try {
    mkdirSync(resolve(STATE_PATH, ".."), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.warn({ err: error }, "Failed to persist IMAP state");
  }
};

const resolveAccounts = async (): Promise<ImapAccount[]> => {
  const connections = (await db
      .select()
      .from(outboundChannelConnections)
      .where(
        and(
          eq(outboundChannelConnections.enabled, true),
          eq(outboundChannelConnections.provider, "smtp"),
        ),
      ));

  return connections
    .filter((connection) => connection.imapEnabled
      ? Boolean(connection.imapHost && connection.imapUsername && connection.imapSecretCiphertext && connection.imapSecretIv && connection.imapSecretTag)
      : Boolean(config.imapEnabled && config.imapUser && config.imapPassword && connection.secretCiphertext))
    .map((connection) => {
      const dedicated = connection.imapEnabled;
      const host = dedicated ? connection.imapHost! : deriveImapHost(connection.host);
      return {
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
        host,
        port: dedicated ? connection.imapPort : config.imapPort || 993,
        secure: dedicated ? connection.imapSecure : true,
        user: dedicated ? connection.imapUsername! : config.imapUser || connection.username,
        password:
          dedicated
            ? decryptSecret({ ciphertext: connection.imapSecretCiphertext!, iv: connection.imapSecretIv!, tag: connection.imapSecretTag! })
            : config.imapPassword || decryptSecret({ ciphertext: connection.secretCiphertext!, iv: connection.secretIv!, tag: connection.secretTag! }),
      };
    });
};

const isOwnOutboundMessage = async (workspaceId: string, messageId: string, fromAddress: string, accountUser: string) => {
  if (!messageId || normalizeEmail(fromAddress) !== normalizeEmail(accountUser)) return false
  return Boolean((await db.$first(db.select({ id: outboxJobs.id }).from(outboxJobs).where(and(eq(outboxJobs.workspaceId, workspaceId), or(eq(outboxJobs.externalId, messageId), eq(outboxJobs.externalId, `<${messageId}>`)))))))
}

const matchThreadByHeader = async (
  workspaceId: string,
  messageIdHeaders: string[],
) => {
  for (const headerId of messageIdHeaders) {
    const cleaned = stripBrackets(headerId);
    if (!cleaned) continue;
    const job = (await db.$first(db
          .select()
          .from(outboxJobs)
          .where(
            and(
              eq(outboxJobs.workspaceId, workspaceId),
              or(eq(outboxJobs.externalId, cleaned), eq(outboxJobs.externalId, `<${cleaned}>`)),
            ),
          )));
    if (job) {
      const thread = (await db.$first(db
              .select()
              .from(messageThreads)
              .where(eq(messageThreads.id, job.threadId))));
      if (thread) return { thread, jobId: job.id, messageId: job.messageId };
    }
  }
  return null;
};

const findOrganicThread = async (
  workspaceId: string,
  fromAddress: string,
  subject: string,
) => {
  const contact = (await db.$first(db
      .select()
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.workspaceId, workspaceId),
          eq(inboxContacts.email, fromAddress),
        ),
      )));
  if (!contact) return null;
  const baseSubject = subject.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
  const threads = (await db
      .select()
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.workspaceId, workspaceId),
          eq(messageThreads.contactId, contact.id),
        ),
      ));
  return (
    threads.find((thread) =>
      thread.subject
        .replace(/^(re|fw|fwd)\s*:\s*/i, "")
        .trim()
        .toLowerCase()
        .includes(baseSubject.toLowerCase().slice(0, 24)),
    ) ?? threads[0] ?? null
  );
};


const normalizeSubject = (value: string) =>
  value.replace(/^[\s>[]*(?:re|fw|fwd)\s*:\s*/i, '').trim().toLowerCase()

const findThreadBySubject = async (workspaceId: string, subject: string) => {
  const normalized = normalizeSubject(subject)
  if (normalized.length < 8) return null
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const threads = (await db
      .select()
      .from(messageThreads)
      .where(and(eq(messageThreads.workspaceId, workspaceId), gte(messageThreads.updatedAt, since))))
  return (
    threads.find((thread) => {
      const candidate = normalizeSubject(thread.subject)
      return candidate === normalized || (candidate.length >= 8 && normalized.includes(candidate))
    }) ?? null
  )
}

const parseAddresses = (value: unknown): { name: string; address: string } => {
  if (Array.isArray(value) && value.length) {
    const first = value[0] as { name?: string; address?: string };
    return {
      name: first.name || "",
      address: (first.address || "").toLowerCase(),
    };
  }
  if (typeof value === "string") {
    const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (match) return { name: match[1].replace(/"/g, ""), address: match[2].toLowerCase() };
    return { name: "", address: value.toLowerCase() };
  }
  return { name: "", address: "" };
};

export const ingestMail = async (account: ImapAccount, mail: ParsedMail) => {
  if (!mail.messageId) return "ignored";
  if (processedMessageIds.has(mail.messageId)) return "duplicate";
  const existing = (await db.$first(db
      .select({ id: messageEntries.id })
      .from(messageEntries)
      .where(
        and(
          eq(messageEntries.workspaceId, account.workspaceId),
          eq(messageEntries.direction, "inbound"),
          eq(messageEntries.externalId, mail.messageId),
        ),
      )));
  if (existing) {
    processedMessageIds.add(mail.messageId);
    return "duplicate";
  }

  const fromAddress = normalizeEmail(mail.fromAddress);
  if (!fromAddress) return "ignored";
  const now = Date.now();

  const headerMatch = (await matchThreadByHeader(account.workspaceId, [
    mail.inReplyTo,
    ...mail.references,
  ].filter((value): value is string => Boolean(value))));
  let thread = headerMatch?.thread ?? null;

  if (!thread) thread = (await findThreadBySubject(account.workspaceId, mail.subject))

  if (!thread) {
    const organic = (await findOrganicThread(
      account.workspaceId,
      fromAddress,
      mail.subject,
    ));
    if (organic) thread = organic;
  }

  let contactId: string;
  let customerId: string | null = null;
  let campaignId: string | null = null;

  if (thread) {
    contactId = thread.contactId;
    customerId = thread.customerId;
    campaignId = thread.campaignId;
  } else {
    const contact = (await db.$first(db
          .select()
          .from(inboxContacts)
          .where(
            and(
              eq(inboxContacts.workspaceId, account.workspaceId),
              eq(inboxContacts.email, fromAddress),
            ),
          )));
    if (contact) {
      contactId = contact.id;
      customerId = contact.customerId;
    } else {
      contactId = createId("ict");
      const company =
        mail.fromName
          ?.split(/[<>\[\]()]/)[0]
          ?.trim()
          ?.replace(/^["']+|["']+$/g, "") || fromAddress.split("@")[1];
      (await db.insert(inboxContacts)
                .values({
                  id: contactId,
                  workspaceId: account.workspaceId,
                  customerId: null,
                  name: mail.fromName || company,
                  company,
                  jobTitle: "待补全",
                  region: "待补全",
                  source: "IMAP 收件",
                  primaryChannel: "邮件",
                  email: fromAddress,
                  phone: null,
                  verificationStatus: "verified",
                  verifiedAt: now,
                  verificationSource: "IMAP 实际收件",
                  createdAt: now,
                  updatedAt: now,
                }));
    }
    customerId = await ensureInboundCustomer(account, contactId, mail, fromAddress, now);
    const threadId = createId("mth");
    (await db.insert(messageThreads)
            .values({
              id: threadId,
              workspaceId: account.workspaceId,
              contactId,
              customerId,
              campaignId: null,
              subject: mail.subject || "客户来信",
              channel: "邮件",
              intent: "待判断",
              status: "open",
              assigneeUserId: null,
              lastMessagePreview: mail.text.slice(0, 200),
              lastMessageAt: mail.date,
              lastInboundAt: mail.date,
              unreadCount: 1,
              createdAt: now,
              updatedAt: now,
            }));
    thread = (await db.$first(db.select().from(messageThreads).where(eq(messageThreads.id, threadId))))!;
  }

  if (thread && !customerId) {
    customerId = await ensureInboundCustomer(account, contactId, mail, fromAddress, now);
    if (customerId) {
      await db.update(messageThreads).set({ customerId, updatedAt: now }).where(and(eq(messageThreads.id, thread.id), eq(messageThreads.workspaceId, account.workspaceId)));
      thread = { ...thread, customerId };
    }
  }

  const inboundId = createId("msg");
  await db.transaction(async (tx) => {
        (await tx.insert(messageEntries)
                .values({
                  id: inboundId,
                  workspaceId: account.workspaceId,
                  threadId: thread!.id,
                  direction: "inbound",
                  messageType: "text",
                  body: mail.text || "（空回复）",
                  status: "received",
                  channel: "邮件",
                  senderLabel: mail.fromName || fromAddress,
                  externalId: mail.messageId,
                  metadataJson: JSON.stringify({
                    source: "imap",
                    connectionId: account.connectionId,
                    from: fromAddress,
                    inReplyTo: mail.inReplyTo,
                  }),
                  createdAt: mail.date,
                  updatedAt: now,
                }));
        (await tx.update(messageThreads)
                .set({
                  lastMessagePreview: mail.text.slice(0, 200),
                  lastMessageAt: mail.date,
                  lastInboundAt: mail.date,
                  unreadCount: sql`${messageThreads.unreadCount} + 1`,
                  updatedAt: now,
                })
                .where(eq(messageThreads.id, thread!.id)));
        if (campaignId) {
          (await tx.update(campaigns)
                    .set({ replyCount: sql`${campaigns.replyCount} + 1`, updatedAt: now })
                    .where(eq(campaigns.id, campaignId)));
          if (customerId)
            (await tx.update(campaignAudienceMembers)
                        .set({ status: "replied", lastEventAt: now, updatedAt: now })
                        .where(
                          and(
                            eq(campaignAudienceMembers.campaignId, campaignId),
                            eq(campaignAudienceMembers.customerId, customerId),
                          ),
                        ));
        }
      });
  processedMessageIds.add(mail.messageId);
  if (customerId) await stopCampaignAudienceForCustomer({ workspaceId: account.workspaceId, customerId, reason: "客户回复" });
  await cancelPendingAutomatedMessagesForThread({ workspaceId: account.workspaceId, threadId: thread.id, reason: '客户已回复，自动取消剩余跟进。' });
  try {
    await applyInboundIntentAutomation({
      workspaceId: account.workspaceId,
      threadId: thread.id,
      customerId,
      fromAddress,
      subject: mail.subject,
      body: mail.text || '',
      receivedAt: mail.date,
    });
  } catch (cause) {
    logger.warn({ threadId: thread.id, error: cause instanceof Error ? cause.message : String(cause) }, "Inbound intent automation failed");
  }
  void persistReplySuggestion({ workspaceId: account.workspaceId, threadId: thread.id }).catch(cause => {
    logger.warn({ threadId: thread.id, error: cause instanceof Error ? cause.message : String(cause) }, "Background reply suggestion failed");
  });
  logger.info(
    { threadId: thread.id, from: fromAddress, subject: mail.subject },
    "IMAP inbound message ingested",
  );
  return "ingested";
};

const pollAccount = async (account: ImapAccount, state: Record<string, number>) => {
  const stateKey = `${account.user}@${account.host}`;
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: account.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { uidNext: true });
      const uidNext = status.uidNext ?? 0;
      const lastUid = state[stateKey] ?? 0;

      if (lastUid === 0) {
        // First run: remember position without processing historical mail.
        state[stateKey] = uidNext;
        saveState(state);
        logger.info({ account: stateKey, uidNext }, "IMAP bootstrap complete");
        return;
      }

      let highestUid = lastUid;
      if (lastUid > 0) {
        const range = `${Math.max(1, lastUid - 100)}:${lastUid + 100}`;
        const messages = client.fetch(range, {
          flags: true,
          envelope: true,
          source: true,
        }, { uid: true });
        for await (const message of messages) {
          try {
            const envelope = (message.envelope ?? {}) as Record<string, unknown>;
            const from = parseAddresses(envelope.from as Parameters<typeof parseAddresses>[0]);
            const messageId = stripBrackets(typeof envelope.messageId === "string" ? envelope.messageId : "");
            const uid = Number(message.uid ?? 0);
            if (uid < lastUid || (await isOwnOutboundMessage(account.workspaceId, messageId, from.address, account.user))) continue;
            highestUid = Math.max(highestUid, uid);
            let text = "";
            try {
              const parsed = await simpleParser(message.source ?? Buffer.alloc(0));
              text = String(parsed.text ?? parsed.html ?? "").replace(/<[^>]+>/g, " ");
            } catch {
              const source = message.source?.toString?.() ?? "";
              text = source.replace(/[\s\S]*?\r?\n\r?\n/, "").replace(/<[^>]+>/g, " ");
            }
            const parsed: ParsedMail = {
              messageId,
              fromAddress: from.address,
              fromName: from.name,
              subject: typeof envelope.subject === "string" ? envelope.subject : "",
              text: text.replace(/\r\n/g, "\n").trim().slice(0, 50_000),
              inReplyTo: stripBrackets(typeof envelope.inReplyTo === "string" ? envelope.inReplyTo : "") || null,
              references: Array.isArray(envelope.references) ? envelope.references.map(value => stripBrackets(typeof value === "string" ? value : "")).filter(Boolean) : [],
              date: envelope.date ? new Date(envelope.date as string | number | Date).getTime() : Date.now(),
            };
            await ingestMail(account, parsed);
            if (!message.flags?.has("\\Seen"))
              await client.messageFlagsAdd(message.uid, ["\\Seen"]);
          } catch (error) {
            logger.warn({ err: error, uid: message.uid }, "Failed to ingest IMAP message");
          }
        }
      }
      if (highestUid > lastUid) {
        state[stateKey] = highestUid + 1;
        saveState(state);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
};

export const createImapReceiver = (intervalMs = 60_000) => {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let state = loadState();

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const accounts = (await resolveAccounts());
      for (const account of accounts) {
        try {
          await pollAccount(account, state);
        } catch (error) {
          logger.warn(
            { err: error, account: `${account.user}@${account.host}` },
            "IMAP poll failed",
          );
        }
      }
    } finally {
      running = false;
    }
  };

  let electionTimer: NodeJS.Timeout | null = null;
  let lease: LeaderLease | null = null;

  const scheduleElection = () => {
    if (electionTimer) return;
    electionTimer = setTimeout(() => {
      electionTimer = null;
      void elect();
    }, config.workerLeaderElectionIntervalMs);
    electionTimer.unref?.();
  };

  const activate = () => {
    if (timer) return;
    if (!config.imapEnabled) return;
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
    logger.info({ intervalMs }, "IMAP receiver elected as leader");
  };

  const elect = async () => {
    if (timer || electionTimer) return;
    if (!config.workerLeaderLock) {
      activate();
      return;
    }
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.imap, () => {
        logger.warn("IMAP receiver leader lock lost; standing down");
        if (timer) clearInterval(timer);
        timer = null;
        void lease?.release();
        lease = null;
        scheduleElection();
      });
      if (lease) activate();
      else {
        logger.info("IMAP receiver is standby; another instance owns the leader lock");
        scheduleElection();
      }
    } catch (error) {
      logger.warn({ err: error }, "IMAP receiver leader election failed; retrying");
      scheduleElection();
    }
  };

  return {
    start: elect,
    async stop() {
      if (electionTimer) clearTimeout(electionTimer);
      electionTimer = null;
      if (timer) clearInterval(timer);
      timer = null;
      const current = lease;
      lease = null;
      await current?.release();
    },
    async pollNow() {
      return tick();
    },
  };
};
