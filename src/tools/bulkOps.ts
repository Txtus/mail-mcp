import { z } from "zod";
import { moveEmails, markEmailsRead, deleteEmails, createFolder } from "../imap.js";

export const moveEmailsSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  uids: z.array(z.number()).describe("Array of email UIDs to move"),
  from_folder: z.string().default("INBOX").describe("Source folder"),
  to_folder: z.string().describe("Destination folder"),
});

export async function handleMoveEmails(args: z.infer<typeof moveEmailsSchema>) {
  try {
    const count = await moveEmails(args.uids, args.from_folder, args.to_folder, args.account);
    return { content: [{ type: "text" as const, text: `Moved ${count} email(s) from "${args.from_folder}" to "${args.to_folder}".` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const markEmailsReadSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  uids: z.array(z.number()).describe("Array of email UIDs to mark as read"),
  folder: z.string().optional().default("INBOX").describe("Folder containing the emails"),
});

export async function handleMarkEmailsRead(args: z.infer<typeof markEmailsReadSchema>) {
  try {
    const count = await markEmailsRead(args.uids, args.folder, args.account);
    return { content: [{ type: "text" as const, text: `Marked ${count} email(s) as read.` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const deleteEmailsSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  uids: z.array(z.number()).describe("Array of email UIDs to delete (moved to Trash)"),
  folder: z.string().optional().default("INBOX").describe("Folder containing the emails"),
});

export async function handleDeleteEmails(args: z.infer<typeof deleteEmailsSchema>) {
  try {
    const count = await deleteEmails(args.uids, args.folder, args.account);
    return { content: [{ type: "text" as const, text: `Deleted ${count} email(s) (moved to Trash).` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}

export const createFolderSchema = z.object({
  account: z.string().optional().describe("Account key (omit for default)"),
  name: z.string().describe("Name of the new folder to create"),
});

export async function handleCreateFolder(args: z.infer<typeof createFolderSchema>) {
  try {
    await createFolder(args.name, args.account);
    return { content: [{ type: "text" as const, text: `Folder "${args.name}" created successfully.` }] };
  } catch (err: any) {
    return { content: [{ type: "text" as const, text: `Error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
