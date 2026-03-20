import { z } from "zod";
import { markEmailRead, moveEmail, listFolders } from "../imap.js";

export const markReadSchema = z.object({
  account: z.string().optional().describe("Account name to use (omit for default)"),
  uid: z.number().describe("UID of the email to mark as read"),
  folder: z.string().optional().default("INBOX").describe("Mailbox folder"),
});

export async function handleMarkRead(args: z.infer<typeof markReadSchema>) {
  try {
    await markEmailRead(args.uid, args.folder, args.account);
    return { content: [{ type: "text", text: `Email UID ${args.uid} marked as read.` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const moveEmailSchema = z.object({
  account: z.string().optional().describe("Account name to use (omit for default)"),
  uid: z.number().describe("UID of the email to move"),
  from_folder: z.string().default("INBOX").describe("Source folder"),
  to_folder: z.string().describe("Destination folder"),
});

export async function handleMoveEmail(args: z.infer<typeof moveEmailSchema>) {
  try {
    await moveEmail(args.uid, args.from_folder, args.to_folder, args.account);
    return { content: [{ type: "text", text: `Email UID ${args.uid} moved from "${args.from_folder}" to "${args.to_folder}".` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const listFoldersSchema = z.object({
  account: z.string().optional().describe("Account name to use (omit for default)"),
});

export async function handleListFolders(args: { account?: string }) {
  try {
    const folders = await listFolders(args.account);
    return { content: [{ type: "text", text: `Available folders:\n${folders.join("\n")}` }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
