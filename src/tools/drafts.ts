import { z } from "zod";
import { listDrafts, createDraft, deleteDraft } from "../imap.js";

// ── List Drafts ───────────────────────────────────────────────────────────────

export const listDraftsSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
});

export async function handleListDrafts(args: z.infer<typeof listDraftsSchema>) {
  try {
    const drafts = await listDrafts(args.account);
    if (drafts.length === 0) {
      return { content: [{ type: "text" as const, text: "No drafts found." }] };
    }
    const lines = drafts.map(
      (d) => `[UID ${d.uid}] ${d.date.slice(0, 10)} | To: ${d.to}\n  Subject: ${d.subject}`
    );
    return { content: [{ type: "text" as const, text: `${drafts.length} draft(s):\n\n${lines.join("\n\n")}` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

// ── Create Draft ──────────────────────────────────────────────────────────────

export const createDraftSchema = z.object({
  to: z.string().describe("Recipient email address"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Plain-text email body"),
  cc: z.string().optional().describe("CC recipients (comma-separated)"),
  account: z.string().optional().describe("Account key (omit for default)"),
});

export async function handleCreateDraft(args: z.infer<typeof createDraftSchema>) {
  try {
    const result = await createDraft({
      to: args.to,
      subject: args.subject,
      text: args.body,
      cc: args.cc,
      account: args.account,
    });
    const uidInfo = result.uid ? ` (UID ${result.uid})` : "";
    return { content: [{ type: "text" as const, text: `✅ Draft saved to "${result.folder}"${uidInfo}.\n  To: ${args.to}\n  Subject: ${args.subject}` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

// ── Delete Draft ──────────────────────────────────────────────────────────────

export const deleteDraftSchema = z.object({
  uid: z.number().describe("UID of the draft to delete (from list_drafts)"),
  account: z.string().optional().describe("Account key (omit for default)"),
});

export async function handleDeleteDraft(args: z.infer<typeof deleteDraftSchema>) {
  try {
    await deleteDraft(args.uid, args.account);
    return { content: [{ type: "text" as const, text: `🗑️ Draft UID ${args.uid} deleted.` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
