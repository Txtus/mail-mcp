import { ImapFlow } from "imapflow";
import fs from "fs";
import path from "path";
import { getAccount, getAccountsByType, ImapConfig, AccountConfig, loadConfig } from "./config.js";
import { getAccessToken } from "./oauth2.js";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EmailSummary {
  uid: number;
  subject: string;
  from: string;
  date: string;
  seen: boolean;
  size: number;
  hasAttachments?: boolean;
}

export interface EmailSummaryWithAccount extends EmailSummary {
  account: string;
}

export interface EmailFull extends EmailSummary {
  to: string;
  cc: string;
  text: string;
  html: string;
  messageId?: string;
  references?: string;
}

export interface Attachment {
  id: string;          // MIME part number, e.g. "2" or "1.2"
  filename: string;
  contentType: string;
  size: number;
  encoding: string;
}

// ── Client factory ────────────────────────────────────────────────────────────

async function createClient(accountKey: string, acc: AccountConfig): Promise<ImapFlow> {
  const cfg = acc.imap;
  let auth: any;

  if (acc.oauth2 && acc.provider && acc.provider !== "generic") {
    const accessToken = await getAccessToken(accountKey, acc.provider, acc.oauth2);
    auth = { user: cfg.user, accessToken };
  } else {
    auth = { user: cfg.user, pass: cfg.password };
  }

  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.tls,
    auth,
    logger: false,
  });
}

/** Wrap IMAP errors with more context */
function wrapError(err: unknown, host: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED"))   throw new Error(`Cannot connect to ${host}: connection refused. Check IMAP_HOST/IMAP_PORT.`);
  if (msg.includes("ETIMEDOUT"))      throw new Error(`Connection to ${host} timed out. Check your network or firewall.`);
  if (msg.includes("Unexpected close")) throw new Error(`Server ${host} closed the connection unexpectedly. This can mean wrong TLS setting or wrong port.`);
  if (msg.includes("auth") || msg.includes("AUTH") || msg.includes("credentials"))
    throw new Error(`Authentication failed for ${host}. Check username and password.`);
  throw new Error(`IMAP error (${host}): ${msg}`);
}

// ── List emails ───────────────────────────────────────────────────────────────

export interface ListEmailsOptions {
  account?: string;
  folder?: string;
  limit?: number;
  from?: string;
  subject?: string;
  since?: string;        // ISO date string
  until?: string;        // ISO date string
  read_status?: "read" | "unread" | "all";
  has_attachments?: boolean;
}

export async function listEmails(options: ListEmailsOptions): Promise<EmailSummary[]> {
  const accountKey = options.account ?? loadConfig().default;
  const acc = getAccount(options.account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    const folder = options.folder ?? "INBOX";
    const limit = options.limit ?? 20;
    await client.mailboxOpen(folder, { readOnly: true });

    // Build server-side search criteria
    const criteria: Record<string, any> = {};
    if (options.since)  criteria.since  = new Date(options.since);
    if (options.until)  criteria.before = new Date(options.until);
    if (options.read_status === "read")   criteria.seen   = true;
    if (options.read_status === "unread") criteria.unseen = true;

    const useSearch = Object.keys(criteria).length > 0;
    let uids: number[] | null = null;
    if (useSearch) {
      const raw = await client.search(criteria, { uid: true });
      uids = raw === false ? [] : raw;
      if (uids.length === 0) { await client.logout(); return []; }
    }

    const fetchTarget = uids ? uids : "1:*";
    const fetchOptions = uids ? { uid: true } : undefined;
    const results: EmailSummary[] = [];

    for await (const msg of client.fetch(fetchTarget as any, {
      uid: true, flags: true, envelope: true, size: true,
      ...(options.has_attachments !== undefined ? { bodyStructure: true } : {}),
    }, fetchOptions)) {
      if (!msg.envelope || !msg.flags) continue;
      const from = msg.envelope.from?.[0]
        ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
        : "";
      const subject = msg.envelope.subject ?? "(no subject)";

      if (options.from    && !from.toLowerCase().includes(options.from.toLowerCase()))       continue;
      if (options.subject && !subject.toLowerCase().includes(options.subject.toLowerCase())) continue;

      const attachments = msg.bodyStructure ? extractAttachmentList(msg.bodyStructure as any) : [];
      const hasAttachments = attachments.length > 0;

      if (options.has_attachments === true  && !hasAttachments) continue;
      if (options.has_attachments === false &&  hasAttachments) continue;

      results.push({
        uid: msg.uid,
        subject,
        from,
        date: msg.envelope.date?.toISOString() ?? "",
        seen: msg.flags.has("\\Seen"),
        size: msg.size ?? 0,
        hasAttachments,
      });
    }

    await client.logout();
    return results.reverse().slice(0, limit);
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Get single email ──────────────────────────────────────────────────────────

export async function getEmail(uid: number, folder = "INBOX", account?: string): Promise<EmailFull | null> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: true });

    const msg = await client.fetchOne(String(uid), {
      uid: true, flags: true, envelope: true,
      bodyStructure: true, source: true,
    }, { uid: true });

    if (!msg) { await client.logout(); return null; }
    if (!msg.envelope || !msg.flags) { await client.logout(); return null; }

    const raw = msg.source?.toString() ?? "";
    const bodyText = extractBody(raw, "text/plain");
    const bodyHtml = extractBody(raw, "text/html");

    const from = msg.envelope.from?.[0]
      ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
      : "";
    const to = (msg.envelope.to ?? []).map((a) => `${a.name ?? ""} <${a.address}>`.trim()).join(", ");
    const cc = (msg.envelope.cc ?? []).map((a) => `${a.name ?? ""} <${a.address}>`.trim()).join(", ");

    // Extract Message-ID and References from raw headers
    const messageId  = extractHeader(raw, "message-id");
    const references = extractHeader(raw, "references");

    const attachments = msg.bodyStructure ? extractAttachmentList(msg.bodyStructure) : [];

    await client.logout();
    return {
      uid: msg.uid,
      subject: msg.envelope.subject ?? "(no subject)",
      from, to, cc,
      date: msg.envelope.date?.toISOString() ?? "",
      seen: msg.flags.has("\\Seen"),
      size: 0,
      text: bodyText,
      html: bodyHtml,
      messageId,
      references,
      hasAttachments: attachments.length > 0,
    };
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Search emails ─────────────────────────────────────────────────────────────

export async function searchEmails(query: string, folder = "INBOX", account?: string): Promise<EmailSummary[]> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: true });

    const rawUids = await client.search({ text: query }, { uid: true });
    const uids = rawUids === false ? [] : rawUids;
    if (uids.length === 0) { await client.logout(); return []; }

    const results: EmailSummary[] = [];
    for await (const msg of client.fetch(uids.slice(-50), {
      uid: true, flags: true, envelope: true, size: true,
    }, { uid: true })) {
      if (!msg.envelope || !msg.flags) continue;
      const from = msg.envelope.from?.[0]
        ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
        : "";
      results.push({
        uid: msg.uid,
        subject: msg.envelope.subject ?? "(no subject)",
        from,
        date: msg.envelope.date?.toISOString() ?? "",
        seen: msg.flags.has("\\Seen"),
        size: msg.size ?? 0,
      });
    }

    await client.logout();
    return results.reverse();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Single-message mutations ──────────────────────────────────────────────────

export async function markEmailRead(uid: number, folder = "INBOX", account?: string): Promise<void> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(folder);
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

export async function moveEmail(uid: number, fromFolder: string, toFolder: string, account?: string): Promise<void> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(fromFolder);
    await client.messageMove(String(uid), toFolder, { uid: true });
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Bulk operations ───────────────────────────────────────────────────────────

/** Move multiple emails in a single IMAP session */
export async function moveEmails(
  uids: number[], fromFolder: string, toFolder: string, account?: string
): Promise<number> {
  if (uids.length === 0) return 0;
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(fromFolder);
    await client.messageMove(uids.join(","), toFolder, { uid: true });
    await client.logout();
    return uids.length;
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

/** Mark multiple emails as read in a single IMAP session */
export async function markEmailsRead(
  uids: number[], folder = "INBOX", account?: string
): Promise<number> {
  if (uids.length === 0) return 0;
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(folder);
    await client.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
    await client.logout();
    return uids.length;
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

/** Delete multiple emails (moves to Trash; permanently deletes if already in Trash) */
export async function deleteEmails(
  uids: number[], folder = "INBOX", account?: string
): Promise<number> {
  if (uids.length === 0) return 0;
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    // Find the trash folder name
    const folders = await client.list();
    const trash = folders.find(
      (f) => f.specialUse === "\\Trash" || /^(Trash|Deleted|Bin)$/i.test(f.name)
    );
    await client.mailboxOpen(folder);
    if (trash && folder !== trash.path) {
      await client.messageMove(uids.join(","), trash.path, { uid: true });
    } else {
      // Already in trash — flag for deletion and expunge
      await client.messageFlagsAdd(uids.join(","), ["\\Deleted"], { uid: true });
      await client.messageDelete(uids.join(","), { uid: true });
    }
    await client.logout();
    return uids.length;
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

/** Create a new IMAP folder */
export async function createFolder(name: string, account?: string): Promise<void> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxCreate(name);
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Folders ───────────────────────────────────────────────────────────────────

export async function listFolders(account?: string): Promise<string[]> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    const folders = await client.list();
    await client.logout();
    return folders.map((f) => f.path);
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Attachments ───────────────────────────────────────────────────────────────

export async function listAttachments(uid: number, folder = "INBOX", account?: string): Promise<Attachment[]> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: true });
    const msg = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true }) as any;
    await client.logout();
    if (!msg?.bodyStructure) return [];
    return extractAttachmentList(msg.bodyStructure);
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

export async function downloadAttachment(
  uid: number, attachmentId: string, folder = "INBOX", account?: string,
  saveDir?: string
): Promise<{ filename: string; path: string; size: number }> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);
  try {
    await client.connect();
    await client.mailboxOpen(folder, { readOnly: true });

    // First get the attachment metadata
    const meta = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true }) as any;
    const attachments = meta?.bodyStructure ? extractAttachmentList(meta.bodyStructure) : [];
    const attachment = attachments.find((a) => a.id === attachmentId);
    const filename = attachment?.filename ?? `attachment-${attachmentId}`;

    // Fetch the specific body part
    const partData = await client.fetchOne(
      String(uid),
      { bodyParts: [attachmentId] } as any,
      { uid: true }
    );

    const rawPart = (partData as any)?.bodyParts?.get(attachmentId);
    const buffer: Buffer = rawPart instanceof Buffer ? rawPart : Buffer.from(rawPart ?? "");

    // Decode if base64 encoded
    const decoded = attachment?.encoding?.toLowerCase() === "base64"
      ? Buffer.from(buffer.toString("ascii"), "base64")
      : buffer;

    const dir = saveDir ?? path.resolve(process.cwd(), "downloads");
    fs.mkdirSync(dir, { recursive: true });
    const safeName = filename.replace(/[/\\?%*:|"<>]/g, "_");
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, decoded);

    await client.logout();
    return { filename: safeName, path: filePath, size: decoded.length };
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Multi-account type queries ────────────────────────────────────────────────

export async function listEmailsByType(options: ListEmailsOptions & { type: string }): Promise<EmailSummaryWithAccount[]> {
  const matches = getAccountsByType(options.type);
  if (matches.length === 0) throw new Error(`No accounts found with type "${options.type}".`);

  const results = await Promise.allSettled(
    matches.map(async ({ key }) => {
      const emails = await listEmails({ ...options, account: key });
      return emails.map((e) => ({ ...e, account: key }));
    })
  );

  const all: EmailSummaryWithAccount[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else console.error("Account error:", r.reason?.message);
  }
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, options.limit ?? 20);
}

export async function searchEmailsByType(query: string, type: string, folder = "INBOX"): Promise<EmailSummaryWithAccount[]> {
  const matches = getAccountsByType(type);
  if (matches.length === 0) throw new Error(`No accounts found with type "${type}".`);

  const results = await Promise.allSettled(
    matches.map(async ({ key }) => {
      const emails = await searchEmails(query, folder, key);
      return emails.map((e) => ({ ...e, account: key }));
    })
  );

  const all: EmailSummaryWithAccount[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else console.error("Account error:", r.reason?.message);
  }
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Mailbox statistics ────────────────────────────────────────────────────────

export interface FolderStats {
  name: string;
  total: number;
  unread: number;
}

export interface MailboxStats {
  account: string;
  folders: FolderStats[];
  totalMessages: number;
  totalUnread: number;
  inbox: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    topSenders: { address: string; count: number }[];
  };
}

export async function getMailboxStats(account?: string): Promise<MailboxStats> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    const folders = await client.list();

    // Get message/unread counts for every folder via STATUS
    const folderStats: FolderStats[] = [];
    for (const folder of folders) {
      try {
        const status = await client.status(folder.path, { messages: true, unseen: true });
        folderStats.push({
          name: folder.path,
          total: status.messages ?? 0,
          unread: status.unseen ?? 0,
        });
      } catch {
        // Some folders (e.g. [Gmail]/All Mail) may not support STATUS — skip
      }
    }

    const totalMessages = folderStats.reduce((s, f) => s + f.total, 0);
    const totalUnread   = folderStats.reduce((s, f) => s + f.unread, 0);

    // For INBOX: count emails by time period + top senders
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today); week.setDate(today.getDate() - 7);
    const month = new Date(today); month.setDate(1);

    let todayCount = 0, weekCount = 0, monthCount = 0;
    const senderMap: Record<string, number> = {};

    try {
      await client.mailboxOpen("INBOX", { readOnly: true });
      const rawUids = await client.search({ since: month }, { uid: true });
      const uids = rawUids === false ? [] : rawUids;

      if (uids.length > 0) {
        for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
          if (!msg.envelope) continue;
          const date = msg.envelope.date ?? new Date(0);
          if (date >= today)  todayCount++;
          if (date >= week)   weekCount++;
          monthCount++;

          const addr = msg.envelope.from?.[0]?.address ?? "unknown";
          senderMap[addr] = (senderMap[addr] ?? 0) + 1;
        }
      }
    } catch {
      // INBOX might be empty or unavailable
    }

    const topSenders = Object.entries(senderMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([address, count]) => ({ address, count }));

    await client.logout();
    return {
      account: accountKey,
      folders: folderStats,
      totalMessages,
      totalUnread,
      inbox: { today: todayCount, thisWeek: weekCount, thisMonth: monthCount, topSenders },
    };
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Contact history ───────────────────────────────────────────────────────────

export interface ContactEmail {
  uid: number;
  folder: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  seen: boolean;
  direction: "received" | "sent";
}

export async function getContactHistory(
  email: string,
  account?: string,
  limit = 50
): Promise<{ emails: ContactEmail[]; stats: { total: number; firstContact: string; lastContact: string; sent: number; received: number } }> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();

    // Find INBOX and Sent folder
    const folders = await client.list();
    const sentFolder = folders.find(
      (f) => f.specialUse === "\\Sent" || /^(Sent|Sent Items|Sent Mail)$/i.test(f.name)
    );
    const foldersToSearch = ["INBOX", ...(sentFolder ? [sentFolder.path] : [])];

    const results: ContactEmail[] = [];
    const emailLower = email.toLowerCase();

    for (const folder of foldersToSearch) {
      try {
        await client.mailboxOpen(folder, { readOnly: true });

        // Search for emails FROM this address
        const rawFrom = await client.search({ from: email }, { uid: true }).catch(() => false as false);
        const rawTo   = await client.search({ to: email },   { uid: true }).catch(() => false as false);
        const fromUids = rawFrom === false ? [] : rawFrom;
        const toUids   = rawTo   === false ? [] : rawTo;

        const allUids = [...new Set([...fromUids, ...toUids])];
        if (allUids.length === 0) continue;

        for await (const msg of client.fetch(allUids, { uid: true, flags: true, envelope: true }, { uid: true })) {
          if (!msg.envelope || !msg.flags) continue;
          const fromAddr = msg.envelope.from?.[0]?.address?.toLowerCase() ?? "";
          const toAddrs  = (msg.envelope.to ?? []).map((a) => a.address?.toLowerCase() ?? "");
          const fromFull = msg.envelope.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
            : "";
          const toFull = (msg.envelope.to ?? []).map((a) => `${a.name ?? ""} <${a.address}>`.trim()).join(", ");

          const isSent     = fromAddr === acc.imap.user.toLowerCase() ||
                             folder === (sentFolder?.path ?? "");
          const isRelevant = fromAddr === emailLower || toAddrs.some((a) => a === emailLower);
          if (!isRelevant) continue;

          results.push({
            uid: msg.uid,
            folder,
            subject: msg.envelope.subject ?? "(no subject)",
            from: fromFull,
            to: toFull,
            date: msg.envelope.date?.toISOString() ?? "",
            seen: msg.flags.has("\\Seen"),
            direction: isSent ? "sent" : "received",
          });
        }
      } catch {
        // Skip inaccessible folders
      }
    }

    await client.logout();

    const sorted = results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    const sent     = sorted.filter((e) => e.direction === "sent").length;
    const received = sorted.filter((e) => e.direction === "received").length;
    const dates    = sorted.map((e) => e.date).filter(Boolean).sort();

    return {
      emails: sorted,
      stats: {
        total:        sorted.length,
        firstContact: dates[0]       ?? "",
        lastContact:  dates[dates.length - 1] ?? "",
        sent,
        received,
      },
    };
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Drafts ────────────────────────────────────────────────────────────────────

export interface DraftSummary {
  uid: number;
  subject: string;
  to: string;
  date: string;
}

async function findDraftsFolder(client: ImapFlow): Promise<string> {
  const folders = await client.list();
  const drafts = folders.find(
    (f) => f.specialUse === "\\Drafts" || /^(Drafts?|Draft Items)$/i.test(f.name)
  );
  if (!drafts) throw new Error("Drafts folder not found on this server.");
  return drafts.path;
}

/** Build a minimal RFC 2822 message suitable for saving as a draft */
function buildRawMessage(opts: {
  from: string; to: string; subject: string;
  text: string; cc?: string; date?: Date;
}): Buffer {
  const date = (opts.date ?? new Date()).toUTCString();
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    `Subject: ${opts.subject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.text,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export async function listDrafts(account?: string): Promise<DraftSummary[]> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    const draftsPath = await findDraftsFolder(client);
    await client.mailboxOpen(draftsPath, { readOnly: true });

    const results: DraftSummary[] = [];
    for await (const msg of client.fetch("1:*", { uid: true, flags: true, envelope: true })) {
      if (!msg.envelope || !msg.flags) continue;
      if (!msg.flags.has("\\Draft") && !draftsPath.toLowerCase().includes("draft")) continue;
      const to = (msg.envelope.to ?? []).map((a) => a.address ?? "").join(", ");
      results.push({
        uid: msg.uid,
        subject: msg.envelope.subject ?? "(no subject)",
        to,
        date: msg.envelope.date?.toISOString() ?? "",
      });
    }

    await client.logout();
    return results.reverse();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

export async function createDraft(opts: {
  to: string; subject: string; text: string;
  cc?: string; account?: string;
}): Promise<{ uid: number | null; folder: string }> {
  const accountKey = opts.account ?? loadConfig().default;
  const acc = getAccount(opts.account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    const draftsPath = await findDraftsFolder(client);

    const raw = buildRawMessage({
      from: `${acc.smtp?.fromName ? acc.smtp.fromName + " " : ""}<${acc.imap.user}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      cc: opts.cc,
    });

    const result = await client.append(draftsPath, raw, ["\\Draft", "\\Seen"]);
    await client.logout();
    return { uid: (result as any)?.uid ?? null, folder: draftsPath };
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

export async function deleteDraft(uid: number, account?: string): Promise<void> {
  const accountKey = account ?? loadConfig().default;
  const acc = getAccount(account);
  const client = await createClient(accountKey, acc);

  try {
    await client.connect();
    const draftsPath = await findDraftsFolder(client);
    await client.mailboxOpen(draftsPath);
    await client.messageFlagsAdd(String(uid), ["\\Deleted"], { uid: true });
    await client.messageDelete(String(uid), { uid: true });
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    wrapError(err, acc.imap.host);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractBody(raw: string, contentType: string): string {
  const lines = raw.split(/\r?\n/);
  let inPart = false, collecting = false;
  const body: string[] = [];
  for (const line of lines) {
    if (line.toLowerCase().startsWith("content-type:") && line.toLowerCase().includes(contentType)) {
      inPart = true; continue;
    }
    if (inPart && line.trim() === "") { collecting = true; continue; }
    if (collecting) {
      if (line.startsWith("--")) break;
      body.push(line);
    }
  }
  return body.join("\n").trim();
}

function extractHeader(raw: string, header: string): string {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (line.toLowerCase().startsWith(`${header.toLowerCase()}:`)) {
      return line.slice(header.length + 1).trim();
    }
  }
  return "";
}

function extractAttachmentList(structure: any, partId = ""): Attachment[] {
  const results: Attachment[] = [];
  if (!structure) return results;

  if (structure.childNodes?.length) {
    structure.childNodes.forEach((child: any, i: number) => {
      const childId = partId ? `${partId}.${i + 1}` : `${i + 1}`;
      results.push(...extractAttachmentList(child, childId));
    });
    return results;
  }

  const id = partId || "1";
  const isAttachment =
    structure.disposition?.value?.toLowerCase() === "attachment" ||
    (structure.type &&
      !["text", "multipart"].includes(structure.type.toLowerCase()) &&
      structure.subtype?.toLowerCase() !== "plain" &&
      structure.subtype?.toLowerCase() !== "html");

  if (isAttachment) {
    const filename =
      structure.disposition?.params?.filename ||
      structure.disposition?.params?.["filename*"] ||
      structure.parameters?.name ||
      `attachment-${id}`;
    results.push({
      id,
      filename,
      contentType: `${structure.type ?? "application"}/${structure.subtype ?? "octet-stream"}`.toLowerCase(),
      size: structure.size ?? 0,
      encoding: structure.encoding ?? "base64",
    });
  }

  return results;
}
