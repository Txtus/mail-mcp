import { z } from "zod";
import { searchEmails, searchEmailsByType } from "../imap.js";

export const searchEmailsSchema = z.object({
  account: z.string().optional().describe("Specific account key to search (e.g. 'personal'). Omit for default."),
  account_type: z.string().optional().describe("Search ALL accounts of this type in parallel (e.g. 'work'). Overrides 'account'."),
  query: z.string().describe("Full-text search query"),
  folder: z.string().optional().default("INBOX").describe("Mailbox folder to search in"),
});

export async function handleSearchEmails(args: z.infer<typeof searchEmailsSchema>) {
  try {
    if (args.account_type) {
      const emails = await searchEmailsByType(args.query, args.account_type, args.folder);
      if (emails.length === 0) return { content: [{ type: "text" as const, text: `No emails found for query: "${args.query}"` }] };
      const lines = emails.map(
        (e) => `[${e.account}] [UID ${e.uid}] ${e.seen ? "✓" : "●"} ${e.date.slice(0, 10)} | From: ${e.from}\n  Subject: ${e.subject}`
      );
      return { content: [{ type: "text" as const, text: `Found ${emails.length} result(s) across all ${args.account_type} accounts:\n\n${lines.join("\n\n")}` }] };
    }

    const emails = await searchEmails(args.query, args.folder, args.account);
    if (emails.length === 0) return { content: [{ type: "text" as const, text: `No emails found for query: "${args.query}"` }] };
    const lines = emails.map(
      (e) => `[UID ${e.uid}] ${e.seen ? "✓" : "●"} ${e.date.slice(0, 10)} | From: ${e.from}\n  Subject: ${e.subject}`
    );
    return { content: [{ type: "text" as const, text: `Found ${emails.length} result(s):\n\n${lines.join("\n\n")}` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
