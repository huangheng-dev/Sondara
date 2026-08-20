import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaigns,
  inboxContacts,
  messageEntries,
  messageThreads,
  outboxJobs,
  outboundChannelConnections,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { decryptSecret } from "../lib/secret-vault.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

type ImapAccount = {
  connectionId: string;
  workspaceId: string;
  host: string;
  port: number;
  user: string;
  password: string;
};

type ParsedMail = {
  messageId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  date: number;
};

const STATE_PATH = resolve(config.databasePath, "..", "imap-state.json");
const processedMessageIds = new Set<string>();

const stripBrackets = (value: string | null | undefined) =>
  (value ?? "").replace(/[<>]/g, "").trim();

const normalizeEmail = (value: string) =>
  value.trim().toLowerCase().replace(/^.*<|>.*$/g, "");

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

const resolveAccounts = (): ImapAccount[] => {
  const connections = db
    .select()
    .from(outboundChannelConnections)
    .where(
      and(
        eq(outboundChannelConnections.enabled, true),
        eq(outboundChannelConnections.provider, "smtp"),
      ),
    )
    .all();

  return connections
    .filter((connection) => connection.secretCiphertext)
    .map((connection) => {
      const host = deriveImapHost(connection.host);
      return {
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
        host,
        port: config.imapPort || 993,
        user: config.imapUser || connection.username,
        password:
          config.imapPassword ||
          decryptSecret({
            ciphertext: connection.secretCiphertext!,
            iv: connection.secretIv!,
            tag: connection.secretTag!,
          }),
      };
    });
};

const isOwnOutboundMessage = (workspaceId: string, messageId: string, fromAddress: string, accountUser: string) => {
  if (!messageId || normalizeEmail(fromAddress) !== normalizeEmail(accountUser)) return false
  return Boolean(db.select({ id: outboxJobs.id }).from(outboxJobs).where(and(eq(outboxJobs.workspaceId, workspaceId), or(eq(outboxJobs.externalId, messageId), eq(outboxJobs.externalId, `<${messageId}>`)))).get())
}

const matchThreadByHeader = (
  workspaceId: string,
  messageIdHeaders: string[],
) => {
  for (const headerId of messageIdHeaders) {
    const cleaned = stripBrackets(headerId);
    if (!cleaned) continue;
    const job = db
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.workspaceId, workspaceId),
          or(eq(outboxJobs.externalId, cleaned), eq(outboxJobs.externalId, `<${cleaned}>`)),
        ),
      )
      .get();
    if (job) {
      const thread = db
        .select()
        .from(messageThreads)
        .where(eq(messageThreads.id, job.threadId))
        .get();
      if (thread) return { thread, jobId: job.id, messageId: job.messageId };
    }
  }
  return null;
};

const findOrganicThread = (
  workspaceId: string,
  fromAddress: string,
  subject: string,
) => {
  const contact = db
    .select()
    .from(inboxContacts)
    .where(
      and(
        eq(inboxContacts.workspaceId, workspaceId),
        eq(inboxContacts.email, fromAddress),
      ),
    )
    .get();
  if (!contact) return null;
  const baseSubject = subject.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
  const threads = db
    .select()
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.workspaceId, workspaceId),
        eq(messageThreads.contactId, contact.id),
      ),
    )
    .all();
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

const findThreadBySubject = (workspaceId: string, subject: string) => {
  const normalized = normalizeSubject(subject)
  if (normalized.length < 8) return null
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const threads = db
    .select()
    .from(messageThreads)
    .where(and(eq(messageThreads.workspaceId, workspaceId), gte(messageThreads.updatedAt, since)))
    .all()
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

const ingestMail = (account: ImapAccount, mail: ParsedMail) => {
  if (!mail.messageId) return "ignored";
  if (processedMessageIds.has(mail.messageId)) return "duplicate";
  const existing = db
    .select({ id: messageEntries.id })
    .from(messageEntries)
    .where(
      and(
        eq(messageEntries.workspaceId, account.workspaceId),
        eq(messageEntries.direction, "inbound"),
        eq(messageEntries.externalId, mail.messageId),
      ),
    )
    .get();
  if (existing) {
    processedMessageIds.add(mail.messageId);
    return "duplicate";
  }

  const fromAddress = normalizeEmail(mail.fromAddress);
  if (!fromAddress) return "ignored";
  const now = Date.now();

  const headerMatch = matchThreadByHeader(account.workspaceId, [
    mail.inReplyTo,
    ...mail.references,
  ].filter((value): value is string => Boolean(value)));
  let thread = headerMatch?.thread ?? null;

  if (!thread) thread = findThreadBySubject(account.workspaceId, mail.subject)

  if (!thread) {
    const organic = findOrganicThread(
      account.workspaceId,
      fromAddress,
      mail.subject,
    );
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
    const contact = db
      .select()
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.workspaceId, account.workspaceId),
          eq(inboxContacts.email, fromAddress),
        ),
      )
      .get();
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
      db.insert(inboxContacts)
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
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    const threadId = createId("mth");
    db.insert(messageThreads)
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
      })
      .run();
    thread = db.select().from(messageThreads).where(eq(messageThreads.id, threadId)).get()!;
  }

  const inboundId = createId("msg");
  db.transaction((tx) => {
    tx.insert(messageEntries)
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
      })
      .run();
    tx.update(messageThreads)
      .set({
        lastMessagePreview: mail.text.slice(0, 200),
        lastMessageAt: mail.date,
        lastInboundAt: mail.date,
        unreadCount: sql`${messageThreads.unreadCount} + 1`,
        updatedAt: now,
      })
      .where(eq(messageThreads.id, thread!.id))
      .run();
    if (campaignId) {
      tx.update(campaigns)
        .set({ replyCount: sql`${campaigns.replyCount} + 1`, updatedAt: now })
        .where(eq(campaigns.id, campaignId))
        .run();
      if (customerId)
        tx.update(campaignAudienceMembers)
          .set({ status: "replied", lastEventAt: now, updatedAt: now })
          .where(
            and(
              eq(campaignAudienceMembers.campaignId, campaignId),
              eq(campaignAudienceMembers.customerId, customerId),
            ),
          )
          .run();
    }
  });
  processedMessageIds.add(mail.messageId);
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
    secure: true,
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
            if (uid < lastUid || isOwnOutboundMessage(account.workspaceId, messageId, from.address, account.user)) continue;
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
            ingestMail(account, parsed);
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
      const accounts = resolveAccounts();
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

  return {
    start() {
      if (timer) return;
      if (!config.imapEnabled) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      logger.info({ intervalMs }, "IMAP receiver started");
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async pollNow() {
      return tick();
    },
  };
};

export type ImapReceiver = ReturnType<typeof createImapReceiver>;
