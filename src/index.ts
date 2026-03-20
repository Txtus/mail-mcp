import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { listEmailsSchema, handleListEmails } from "./tools/listEmails.js";
import { getEmailSchema, handleGetEmail } from "./tools/getEmail.js";
import { searchEmailsSchema, handleSearchEmails } from "./tools/searchEmails.js";
import { sendEmailSchema, handleSendEmail, replyEmailSchema, handleReplyEmail, forwardEmailSchema, handleForwardEmail } from "./tools/sendEmail.js";
import { markReadSchema, handleMarkRead, moveEmailSchema, handleMoveEmail, listFoldersSchema, handleListFolders } from "./tools/markRead.js";
import { moveEmailsSchema, handleMoveEmails, markEmailsReadSchema, handleMarkEmailsRead, deleteEmailsSchema, handleDeleteEmails, createFolderSchema, handleCreateFolder } from "./tools/bulkOps.js";
import { listAttachmentsSchema, handleListAttachments, downloadAttachmentSchema, handleDownloadAttachment } from "./tools/attachments.js";
import { listAccountsSchema, handleListAccounts } from "./tools/listAccounts.js";
import { getStatsSchema, handleGetStats } from "./tools/stats.js";
import { contactHistorySchema, handleContactHistory } from "./tools/contactHistory.js";
import { listDraftsSchema, handleListDrafts, createDraftSchema, handleCreateDraft, deleteDraftSchema, handleDeleteDraft } from "./tools/drafts.js";

const server = new McpServer({ name: "imap-mcp-server", version: "2.0.0" });

// ── Accounts ──────────────────────────────────────────────────────────────────
server.tool("list_accounts",    "List all configured email accounts and their types", listAccountsSchema.shape, handleListAccounts);

// ── Read ──────────────────────────────────────────────────────────────────────
server.tool("list_emails",      "List emails with optional filters: date range, read status, attachments, sender, subject", listEmailsSchema.shape, handleListEmails);
server.tool("get_email",        "Retrieve full content of an email by UID (includes Message-ID for replies/forwards)", getEmailSchema.shape, handleGetEmail);
server.tool("search_emails",    "Full-text search over emails in a folder", searchEmailsSchema.shape, handleSearchEmails);

// ── Send ──────────────────────────────────────────────────────────────────────
server.tool("send_email",       "Compose and send a new email", sendEmailSchema.shape, handleSendEmail);
server.tool("reply_email",      "Reply to an existing email thread", replyEmailSchema.shape, handleReplyEmail);
server.tool("forward_email",    "Forward an email to another recipient", forwardEmailSchema.shape, handleForwardEmail);

// ── Single-message manage ─────────────────────────────────────────────────────
server.tool("mark_read",        "Mark a single email as read", markReadSchema.shape, handleMarkRead);
server.tool("move_email",       "Move a single email to another folder", moveEmailSchema.shape, handleMoveEmail);

// ── Bulk operations ───────────────────────────────────────────────────────────
server.tool("move_emails",      "Move multiple emails at once (bulk)", moveEmailsSchema.shape, handleMoveEmails);
server.tool("mark_emails_read", "Mark multiple emails as read at once (bulk)", markEmailsReadSchema.shape, handleMarkEmailsRead);
server.tool("delete_emails",    "Delete multiple emails at once — moves to Trash (bulk)", deleteEmailsSchema.shape, handleDeleteEmails);

// ── Folders ───────────────────────────────────────────────────────────────────
server.tool("list_folders",     "List all IMAP folders/mailboxes", listFoldersSchema.shape, handleListFolders);
server.tool("create_folder",    "Create a new IMAP folder", createFolderSchema.shape, handleCreateFolder);

// ── Attachments ───────────────────────────────────────────────────────────────
server.tool("list_attachments",     "List all attachments in an email", listAttachmentsSchema.shape, handleListAttachments);
server.tool("download_attachment",  "Download an attachment and save it to the downloads/ folder", downloadAttachmentSchema.shape, handleDownloadAttachment);

// ── Stats & insights ──────────────────────────────────────────────────────────
server.tool("get_stats",          "Get mailbox statistics: unread counts, folder totals, INBOX activity this month, and top senders", getStatsSchema.shape, handleGetStats);
server.tool("get_contact_history","Get the full email history with a specific person — all sent and received emails", contactHistorySchema.shape, handleContactHistory);

// ── Drafts ────────────────────────────────────────────────────────────────────
server.tool("list_drafts",        "List all saved email drafts", listDraftsSchema.shape, handleListDrafts);
server.tool("create_draft",       "Save a new email draft to the Drafts folder (without sending)", createDraftSchema.shape, handleCreateDraft);
server.tool("delete_draft",       "Permanently delete a draft by UID", deleteDraftSchema.shape, handleDeleteDraft);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("📬 IMAP MCP Server v2.0 running on stdio");
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
