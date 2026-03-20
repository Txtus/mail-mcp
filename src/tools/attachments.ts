import { z } from "zod";
import { listAttachments, downloadAttachment } from "../imap.js";

export const listAttachmentsSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  uid: z.number().describe("UID of the email"),
  folder: z.string().optional().default("INBOX").describe("Folder containing the email"),
});

export async function handleListAttachments(args: z.infer<typeof listAttachmentsSchema>) {
  try {
    const attachments = await listAttachments(args.uid, args.folder, args.account);
    if (attachments.length === 0) {
      return { content: [{ type: "text" as const, text: `Email UID ${args.uid} has no attachments.` }] };
    }
    const lines = attachments.map(
      (a) => `[ID: ${a.id}] ${a.filename}  (${a.contentType}, ${formatSize(a.size)})`
    );
    return {
      content: [{ type: "text" as const, text: `Attachments in email UID ${args.uid}:\n\n${lines.join("\n")}` }],
    };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const downloadAttachmentSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  uid: z.number().describe("UID of the email"),
  attachment_id: z.string().describe("Attachment ID from list_attachments (e.g. '2')"),
  folder: z.string().optional().default("INBOX").describe("Folder containing the email"),
});

export async function handleDownloadAttachment(args: z.infer<typeof downloadAttachmentSchema>) {
  try {
    const result = await downloadAttachment(args.uid, args.attachment_id, args.folder, args.account);
    return {
      content: [{
        type: "text" as const,
        text: `Downloaded "${result.filename}" (${formatSize(result.size)}) to:\n${result.path}`,
      }],
    };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
