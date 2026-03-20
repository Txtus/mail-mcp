import { z } from "zod";
import { listEmails, listEmailsByType } from "../imap.js";

export const listEmailsSchema = z.object({
  account: z.string().optional().describe("Specific account key (omit for default)"),
  account_type: z.string().optional().describe("Query ALL accounts of this type in parallel (e.g. 'work'). Overrides 'account'."),
  folder: z.string().optional().default("INBOX").describe("Mailbox folder"),
  limit: z.number().optional().default(20).describe("Max emails to return"),
  from: z.string().optional().describe("Filter by sender (partial match)"),
  subject: z.string().optional().describe("Filter by subject (partial match)"),
  since: z.string().optional().describe("Only emails on/after this date (ISO format, e.g. '2024-01-01')"),
  until: z.string().optional().describe("Only emails before this date (ISO format, e.g. '2024-12-31')"),
  read_status: z.enum(["read", "unread", "all"]).optional().default("all").describe("Filter by read/unread status"),
  has_attachments: z.boolean().optional().describe("Filter to only emails with (true) or without (false) attachments"),
});

export async function handleListEmails(args: z.infer<typeof listEmailsSchema>) {
  try {
    if (args.account_type) {
      const emails = await listEmailsByType({ ...args, type: args.account_type });
      if (emails.length === 0) return { content: [{ type: "text" as const, text: "No emails found." }] };
      const lines = emails.map(formatEmail.bind(null, true));
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    }

    const emails = await listEmails(args);
    if (emails.length === 0) return { content: [{ type: "text" as const, text: "No emails found." }] };
    const lines = emails.map(formatEmail.bind(null, false));
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

function formatEmail(showAccount: boolean, e: any): string {
  const acct = showAccount ? `[${e.account}] ` : "";
  const attach = e.hasAttachments ? " 📎" : "";
  return `${acct}[UID ${e.uid}] ${e.seen ? "✓" : "●"} ${e.date.slice(0, 10)} | From: ${e.from}${attach}\n  Subject: ${e.subject}`;
}
