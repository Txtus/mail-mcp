import { z } from "zod";
import { getContactHistory } from "../imap.js";

export const contactHistorySchema = z.object({
  email: z.string().describe("The email address to look up (e.g. 'john@company.com')"),
  account: z.string().optional().describe("Account key to search (omit for default)"),
  limit: z.number().optional().default(50).describe("Max emails to return (default 50)"),
});

export async function handleContactHistory(args: z.infer<typeof contactHistorySchema>) {
  try {
    const { emails, stats } = await getContactHistory(args.email, args.account, args.limit);

    if (emails.length === 0) {
      return { content: [{ type: "text" as const, text: `No emails found with ${args.email}.` }] };
    }

    const lines: string[] = [];
    lines.push(`📇 Contact history with ${args.email}`);
    lines.push(`   Total emails: ${stats.total}  |  Sent: ${stats.sent}  |  Received: ${stats.received}`);
    lines.push(`   First contact: ${stats.firstContact.slice(0, 10)}`);
    lines.push(`   Last contact:  ${stats.lastContact.slice(0, 10)}`);
    lines.push(``);

    for (const e of emails) {
      const dir   = e.direction === "sent" ? "→ SENT" : "← RECV";
      const seen  = e.seen ? "✓" : "●";
      lines.push(`[UID ${e.uid}] [${e.folder}] ${seen} ${dir} ${e.date.slice(0, 10)}`);
      lines.push(`  From: ${e.from}`);
      lines.push(`  To:   ${e.to}`);
      lines.push(`  Subject: ${e.subject}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
