import { z } from "zod";
import { getMailboxStats } from "../imap.js";
import { loadConfig, getAccountsByType } from "../config.js";

export const getStatsSchema = z.object({
  account: z.string().optional().describe("Account key to check (omit for default). Use 'all' to check all accounts."),
});

export async function handleGetStats(args: z.infer<typeof getStatsSchema>) {
  try {
    const checkAll = args.account === "all";

    if (checkAll) {
      const config = loadConfig();
      const keys = Object.keys(config.accounts);
      const results = await Promise.allSettled(keys.map((k) => getMailboxStats(k)));
      const lines: string[] = [];

      for (let i = 0; i < keys.length; i++) {
        const r = results[i];
        if (r.status === "rejected") {
          lines.push(`❌ ${keys[i]}: ${r.reason?.message ?? "error"}`);
        } else {
          lines.push(formatStats(r.value));
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n\n" + "─".repeat(50) + "\n\n") }] };
    }

    const stats = await getMailboxStats(args.account);
    return { content: [{ type: "text" as const, text: formatStats(stats) }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

function formatStats(s: Awaited<ReturnType<typeof getMailboxStats>>): string {
  const lines: string[] = [];
  lines.push(`📬 Stats for account: ${s.account}`);
  lines.push(`   Total messages: ${s.totalMessages.toLocaleString()}`);
  lines.push(`   Total unread:   ${s.totalUnread.toLocaleString()}`);

  lines.push(`\n📥 INBOX activity:`);
  lines.push(`   Today:      ${s.inbox.today}`);
  lines.push(`   This week:  ${s.inbox.thisWeek}`);
  lines.push(`   This month: ${s.inbox.thisMonth}`);

  if (s.inbox.topSenders.length > 0) {
    lines.push(`\n👥 Top senders (this month):`);
    s.inbox.topSenders.forEach((sender, i) => {
      lines.push(`   ${i + 1}. ${sender.address} (${sender.count})`);
    });
  }

  const unreadFolders = s.folders.filter((f) => f.unread > 0).sort((a, b) => b.unread - a.unread);
  if (unreadFolders.length > 0) {
    lines.push(`\n📂 Folders with unread messages:`);
    unreadFolders.slice(0, 10).forEach((f) => {
      lines.push(`   ${f.name}: ${f.unread} unread / ${f.total} total`);
    });
  }

  return lines.join("\n");
}
