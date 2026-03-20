# 📬 IMAP MCP Server

An MCP (Model Context Protocol) server that gives Claude access to any IMAP/SMTP mailbox — read, search, send, and organize emails directly from Claude Desktop.

## Features

- **17 MCP tools** — list, read, search, send, reply, forward, move, delete, and more
- **Multi-account** — manage multiple mailboxes (work, personal, freelance…) in parallel
- **Gmail & Office 365 OAuth2** — sign in with Google / Microsoft instead of passwords
- **Auto-discovery** — detects IMAP/SMTP settings automatically for 20+ providers
- **Config UI** — browser-based account manager at `http://localhost:4321`
- **Bulk operations** — move, delete, or mark multiple emails at once
- **Attachments** — list and download attachments
- **Advanced filters** — filter by date, read status, account type, attachments

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Add your email account

```bash
npm run config
```

This opens the Config UI at `http://localhost:4321`. Enter your email address and either:
- **App Password** (Gmail: requires 2-Step Verification → [create one here](https://myaccount.google.com/apppasswords))
- **OAuth2** (Gmail / Office 365 — see section below)
- **Password** (any regular IMAP provider)

### 3. Connect to Claude Desktop

```bash
bash setup-claude.sh
```

This auto-detects your Node.js path and writes the correct config to Claude Desktop. Restart Claude Desktop and you're done.

---

## MCP Tools

| Tool | Description |
|---|---|
| `list_emails` | List emails with filters (date, read status, attachments, account type) |
| `get_email` | Fetch a full email including HTML body |
| `search_emails` | Full-text search across folders |
| `send_email` | Send an email via SMTP |
| `reply_email` | Reply to an email (with quoted original) |
| `forward_email` | Forward an email to another recipient |
| `mark_read` | Mark a single email as read/unread |
| `mark_emails_read` | Mark multiple emails at once |
| `move_email` | Move a single email to a folder |
| `move_emails` | Move multiple emails at once |
| `delete_emails` | Delete multiple emails |
| `list_folders` | List all IMAP folders |
| `create_folder` | Create a new IMAP folder |
| `list_attachments` | List attachments in an email |
| `download_attachment` | Download an attachment (returns Base64) |
| `list_accounts` | Show all configured accounts and types |

---

## Multi-Account Setup

Accounts are stored in `accounts.json`. Copy the example to get started:

```bash
cp accounts.json.example accounts.json
```

Each account has an optional `type` field for grouping (e.g. `"work"`, `"personal"`). Claude can then query all work accounts at once with `account_type: "work"`.

```json
{
  "default": "personal",
  "accounts": {
    "personal": {
      "name": "Personal",
      "type": "personal",
      "imap": { "host": "imap.your-provider.com", "port": 993, "user": "you@example.com", "password": "…", "tls": true },
      "smtp": { "host": "smtp.your-provider.com", "port": 465, "user": "you@example.com", "password": "…", "tls": true }
    },
    "work_gmail": {
      "name": "Work Gmail",
      "type": "work",
      "provider": "gmail",
      "oauth2": {
        "clientId": "…apps.googleusercontent.com",
        "clientSecret": "…",
        "refreshToken": "…"
      },
      "imap": { "host": "imap.gmail.com", "port": 993, "user": "you@company.com", "password": "", "tls": true },
      "smtp": { "host": "smtp.gmail.com", "port": 465, "user": "you@company.com", "password": "", "tls": true }
    }
  }
}
```

---

## Gmail & Office 365 OAuth2

Google and Microsoft block regular password auth for IMAP. Use OAuth2 instead.

### Gmail Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project
2. Enable the **Gmail API** (APIs & Services → Library → Gmail API → Enable)
3. Configure the **OAuth consent screen** (External, Testing mode is fine)
4. Add your Gmail address as a **test user** (required — without this you get error 403)
5. Create an **OAuth2 Client ID** → type: **Web application**
6. Add `http://localhost:4321/oauth2/callback` as an authorized redirect URI
7. Copy the **Client ID** and **Client Secret**
8. In the Config UI, enter your email → fill in Client ID + Secret → click **Sign in with Google**

> ⚠️ Common errors:
> - `redirect_uri_mismatch` → the redirect URI in Google Cloud must be exactly `http://localhost:4321/oauth2/callback`
> - `access_denied` (403) → your Gmail address must be added as a test user in the OAuth consent screen

### Office 365 / Exchange Setup

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Create a new registration with redirect URI `http://localhost:4321/oauth2/callback`
3. Add API permissions: `IMAP.AccessAsUser.All` and `SMTP.Send` (under Office 365 Exchange Online)
4. Grant admin consent
5. Create a **Client Secret** under Certificates & Secrets
6. In the Config UI, enter your email → fill in Client ID + Secret + Tenant ID → click **Sign in with Microsoft**

---

## Project Structure

```
imap-mcp-server/
├── src/
│   ├── index.ts            # MCP Server entry (registers all 17 tools)
│   ├── imap.ts             # IMAP operations (imapflow)
│   ├── smtp.ts             # SMTP sending (nodemailer)
│   ├── config.ts           # Multi-account config loader
│   ├── oauth2.ts           # OAuth2 token refresh (Google + Microsoft)
│   ├── autodiscover.ts     # Auto-discover IMAP/SMTP settings
│   ├── configServer.ts     # Config UI HTTP server (port 4321)
│   └── tools/
│       ├── listEmails.ts
│       ├── getEmail.ts
│       ├── searchEmails.ts
│       ├── sendEmail.ts    # send + reply + forward
│       ├── markRead.ts
│       ├── listAccounts.ts
│       ├── bulkOps.ts      # move / delete / mark multiple emails
│       └── attachments.ts  # list + download attachments
├── accounts.json           # Your account config (gitignored)
├── accounts.json.example   # Example config
├── run.sh                  # Shell wrapper (fixes PATH for Claude Desktop)
├── setup-claude.sh         # Auto-configure Claude Desktop
├── package.json
└── tsconfig.json
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run config` | Open the Config UI at http://localhost:4321 |
| `npm run dev` | Start the MCP server directly (for testing) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run the compiled server |
| `bash setup-claude.sh` | Auto-configure Claude Desktop |

---

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **IMAP**: [imapflow](https://imapflow.com) — modern Promise-based IMAP client
- **SMTP**: [nodemailer](https://nodemailer.com)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://modelcontextprotocol.io)
- **OAuth2**: raw HTTPS — no extra dependencies
