/**
 * Config UI Server — npm run config
 * Manages accounts.json with provider presets + OAuth2 setup wizard
 */

import http from "http";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ImapFlow } from "imapflow";
import { discoverSettings } from "./autodiscover.js";
import {
  getGoogleAuthUrl, getMicrosoftAuthUrl,
  exchangeGoogleCode, exchangeMicrosoftCode,
} from "./oauth2.js";

const CONFIG_PATH = path.resolve(process.cwd(), "accounts.json");
const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2/callback`;

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { default: "", accounts: {} };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}
function writeConfig(data: unknown) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// Temporary store for in-flight OAuth2 state
const oauthState = new Map<string, {
  provider: string; clientId: string; clientSecret: string; tenantId?: string;
  accountKey?: string;
  // Quick-flow extras (auto-save on callback)
  quickEmail?: string; quickName?: string; quickType?: string; quickSettings?: any;
}>();

// ── HTML ──────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>IMAP MCP — Config</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;padding:32px 16px}
    h1{font-size:1.4rem;font-weight:600;margin-bottom:4px}
    .subtitle{color:#64748b;font-size:.85rem;margin-bottom:32px}
    .card{background:#1a1d27;border:1px solid #2d3148;border-radius:12px;padding:20px;margin-bottom:16px}
    .card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .card-title{font-size:.95rem;font-weight:600}
    .badge{font-size:.7rem;padding:2px 8px;border-radius:99px;background:#1e3a5f;color:#60a5fa;font-weight:500}
    .badge.default{background:#14532d;color:#4ade80}
    .badge.gmail{background:#7f1d1d;color:#fca5a5}
    .badge.office365{background:#1e3a5f;color:#93c5fd}
    .badge.exchange{background:#312e81;color:#a5b4fc}
    .actions{display:flex;gap:8px}
    button{border:none;border-radius:8px;padding:7px 14px;font-size:.82rem;font-weight:500;cursor:pointer;transition:opacity .15s}
    button:hover{opacity:.85}
    button:disabled{opacity:.45;cursor:not-allowed}
    .btn-primary{background:#3b82f6;color:#fff}
    .btn-danger{background:#dc2626;color:#fff}
    .btn-ghost{background:#2d3148;color:#e2e8f0}
    .btn-success{background:#16a34a;color:#fff}
    .btn-google{background:#fff;color:#1f2937;display:flex;align-items:center;gap:8px;padding:9px 18px;font-size:.85rem;font-weight:600;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
    .btn-microsoft{background:#0078d4;color:#fff;display:flex;align-items:center;gap:8px;padding:9px 18px;font-size:.85rem;font-weight:600;border-radius:8px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:.82rem;color:#94a3b8}
    .info-grid span{color:#e2e8f0}
    hr{border:none;border-top:1px solid #2d3148;margin:16px 0}
    .overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px}
    .modal{background:#1a1d27;border:1px solid #2d3148;border-radius:14px;padding:28px;width:100%;max-width:600px;max-height:90vh;overflow-y:auto}
    .modal h2{font-size:1.1rem;margin-bottom:20px}
    .section-label{font-size:.75rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 10px}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .form-group{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
    label{font-size:.8rem;color:#94a3b8}
    input,select{background:#0f1117;border:1px solid #2d3148;border-radius:8px;color:#e2e8f0;padding:8px 12px;font-size:.85rem;width:100%;outline:none;transition:border-color .15s}
    input:focus,select:focus{border-color:#3b82f6}
    .checkbox-row{display:flex;align-items:center;gap:8px;font-size:.85rem}
    input[type=checkbox]{width:auto;accent-color:#3b82f6}
    .modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}
    .empty{text-align:center;color:#64748b;padding:32px}
    .toast{position:fixed;bottom:24px;right:24px;background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;font-size:.85rem;opacity:0;transition:opacity .3s;pointer-events:none;z-index:200}
    .toast.show{opacity:1}
    .toast.error{background:#dc2626}
    .oauth-box{background:#0f1117;border:1px solid #2d3148;border-radius:10px;padding:16px;margin-top:4px}
    .oauth-box h3{font-size:.85rem;font-weight:600;margin-bottom:6px;color:#94a3b8}
    .oauth-token-row{display:flex;align-items:center;gap:8px;margin-top:8px}
    .oauth-token-row input{flex:1}
    .provider-tabs{display:flex;gap:8px;margin-bottom:20px}
    .provider-tab{flex:1;padding:10px;border-radius:8px;border:1px solid #2d3148;background:#0f1117;color:#94a3b8;cursor:pointer;font-size:.82rem;text-align:center;transition:all .15s}
    .provider-tab.active{border-color:#3b82f6;background:#1e3a5f;color:#93c5fd}
    .info-note{background:#1e3a5f22;border:1px solid #1e3a5f;border-radius:8px;padding:10px 14px;font-size:.82rem;color:#94a3b8;margin-bottom:12px;line-height:1.6}
    .info-note a{color:#60a5fa}
    .info-note.warn{background:#431407;border-color:#7c2d12}
    code{background:#0f1117;border:1px solid #2d3148;border-radius:4px;padding:1px 5px;font-size:.8rem}
    .divider{display:flex;align-items:center;gap:10px;color:#475569;font-size:.78rem;margin:10px 0}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#2d3148}
    .ql-oauth-wrap{animation:fadeIn .2s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  </style>
</head>
<body>
  <h1>📬 IMAP MCP Server</h1>
  <p class="subtitle">Manage email accounts — saved to <code>accounts.json</code></p>

  <!-- Quick Login -->
  <div class="card" id="quick-login-card">
    <div class="card-title" style="margin-bottom:14px">➕ Add Account</div>

    <!-- Row 1: email + name + type always visible -->
    <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
      <div class="form-group">
        <label>Email address</label>
        <input id="ql-email" type="email" placeholder="you@gmail.com" oninput="detectProvider(this.value)" onkeydown="if(event.key==='Enter')quickLogin()"/>
      </div>
      <div class="form-group">
        <label>Display name <span style="color:#64748b;font-weight:400">(optional)</span></label>
        <input id="ql-name" placeholder="Personal Mail"/>
      </div>
      <div class="form-group">
        <label>Type <span style="color:#64748b;font-weight:400">(optional)</span></label>
        <input id="ql-type" placeholder="personal / work …" list="type-suggestions"/>
        <datalist id="type-suggestions">
          <option value="personal"/><option value="work"/><option value="freelance"/>
        </datalist>
      </div>
    </div>

    <!-- Provider notice (Gmail / O365) -->
    <div id="ql-notice" style="display:none" class="info-note"></div>

    <!-- Password + Connect (generic IMAP or App Password) -->
    <div id="ql-password-section">
      <div class="form-row" style="align-items:flex-end">
        <div class="form-group">
          <label id="ql-pass-label">Password</label>
          <input id="ql-pass" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')quickLogin()"/>
        </div>
        <div class="form-group" style="justify-content:flex-end">
          <button class="btn-primary" id="ql-btn" onclick="quickLogin()" style="width:100%;padding:9px">
            Connect →
          </button>
        </div>
      </div>
    </div>

    <!-- OAuth2 sign-in (Gmail / O365) -->
    <div id="ql-oauth-section" class="ql-oauth-wrap" style="display:none">
      <div class="divider" id="ql-or-divider">or sign in with OAuth2</div>
      <div class="oauth-box">
        <h3 id="ql-oauth-title">Google OAuth2</h3>
        <p style="font-size:.79rem;color:#64748b;margin-bottom:10px;line-height:1.5">
          Enter your OAuth2 app credentials, then click the sign-in button.<br>
          <a id="ql-oauth-help" href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:#60a5fa">How to create credentials →</a>
        </p>
        <div class="form-row">
          <div class="form-group" style="margin-bottom:8px">
            <label>Client ID</label>
            <input id="ql-oauth-clientid" placeholder="…apps.googleusercontent.com"/>
          </div>
          <div class="form-group" style="margin-bottom:8px">
            <label>Client Secret</label>
            <input id="ql-oauth-secret" type="password" placeholder="••••••••"/>
          </div>
        </div>
        <div id="ql-tenant-row" class="form-group" style="display:none;margin-bottom:10px">
          <label>Tenant ID <span style="color:#64748b;font-weight:400">(or "common")</span></label>
          <input id="ql-oauth-tenantid" placeholder="common"/>
        </div>
        <button id="ql-oauth-btn" class="btn-google" onclick="quickOAuthConnect()">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>

    <div id="ql-status" style="font-size:.82rem;color:#64748b;margin-top:8px;min-height:18px"></div>
  </div>

  <div id="accounts-list"></div>
  <button class="btn-ghost" onclick="openModal()" style="margin-bottom:32px;font-size:.8rem">⚙ Advanced setup (manual / OAuth2)</button>

  <!-- Modal -->
  <div class="overlay" id="modal" style="display:none">
    <div class="modal">
      <h2 id="modal-title">Add Account</h2>
      <input type="hidden" id="editing-key"/>

      <!-- Provider tabs -->
      <div class="section-label">Provider</div>
      <div class="provider-tabs">
        <div class="provider-tab active" onclick="selectProvider('generic')"   id="tab-generic">🌐 Generic IMAP</div>
        <div class="provider-tab"        onclick="selectProvider('gmail')"     id="tab-gmail">✉️ Gmail</div>
        <div class="provider-tab"        onclick="selectProvider('office365')" id="tab-office365">🔷 Office 365</div>
        <div class="provider-tab"        onclick="selectProvider('exchange')"  id="tab-exchange">🏢 Exchange</div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Account Key (e.g. "personal", "work")</label>
          <input id="f-key" placeholder="personal"/>
        </div>
        <div class="form-group">
          <label>Display Name</label>
          <input id="f-name" placeholder="Personal Mail"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Type <span style="color:#64748b;font-weight:400">(for grouping)</span></label>
          <input id="f-type" placeholder="personal / work / freelance …" list="type-suggestions2"/>
          <datalist id="type-suggestions2">
            <option value="personal"/><option value="work"/><option value="freelance"/><option value="school"/>
          </datalist>
        </div>
        <div class="form-group" style="justify-content:flex-end;padding-top:22px">
          <label class="checkbox-row">
            <input type="checkbox" id="f-is-default"/> Set as default account
          </label>
        </div>
      </div>

      <!-- Gmail hint -->
      <div id="oauth-hint-gmail" class="info-note" style="display:none">
        Gmail requires OAuth2 or an <strong>App Password</strong>.<br>
        • <strong>App Password (easier)</strong>: Enable 2FA → <a href="https://myaccount.google.com/apppasswords" target="_blank">create App Password</a> → paste it as IMAP password below.<br>
        • <strong>OAuth2 (recommended)</strong>: Fill in Client ID &amp; Secret below and click "Connect with Google".
      </div>
      <!-- Office 365 hint -->
      <div id="oauth-hint-office365" class="info-note" style="display:none">
        Office 365 supports IMAP/SMTP OAuth2 via Azure AD.<br>
        Register an app at <a href="https://portal.azure.com" target="_blank">portal.azure.com</a> with <code>IMAP.AccessAsUser.All</code> and <code>SMTP.Send</code> permissions.
      </div>

      <div class="section-label">IMAP (Incoming)</div>
      <div class="form-row">
        <div class="form-group">
          <label>Host</label>
          <input id="f-imap-host" placeholder="imap.gmail.com"/>
        </div>
        <div class="form-group">
          <label>Port</label>
          <input id="f-imap-port" type="number" value="993"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Username / Email</label>
          <input id="f-imap-user" placeholder="you@gmail.com"/>
        </div>
        <div class="form-group">
          <label id="f-imap-pass-label">Password / App Password</label>
          <input id="f-imap-pass" type="password" placeholder="••••••••"/>
        </div>
      </div>
      <div class="form-group">
        <label class="checkbox-row"><input type="checkbox" id="f-imap-tls" checked/> Use TLS/SSL</label>
      </div>

      <div class="section-label">SMTP (Outgoing)</div>
      <div class="form-row">
        <div class="form-group">
          <label>Host</label>
          <input id="f-smtp-host" placeholder="smtp.gmail.com"/>
        </div>
        <div class="form-group">
          <label>Port</label>
          <input id="f-smtp-port" type="number" value="465"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Username / Email</label>
          <input id="f-smtp-user" placeholder="you@gmail.com"/>
        </div>
        <div class="form-group">
          <label>Password / App Password</label>
          <input id="f-smtp-pass" type="password" placeholder="••••••••"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>From Name (optional)</label>
          <input id="f-smtp-fromname" placeholder="Your Name"/>
        </div>
        <div class="form-group" style="justify-content:flex-end;padding-top:22px">
          <label class="checkbox-row"><input type="checkbox" id="f-smtp-tls" checked/> Use TLS/SSL</label>
        </div>
      </div>

      <!-- OAuth2 section (Gmail / Office365 / Exchange) -->
      <div id="oauth2-section" style="display:none">
        <div class="section-label">OAuth2 (optional — leave empty to use password above)</div>
        <div class="oauth-box">
          <h3>App credentials</h3>
          <div class="form-row">
            <div class="form-group">
              <label>Client ID</label>
              <input id="f-oauth-clientid" placeholder="...apps.googleusercontent.com"/>
            </div>
            <div class="form-group">
              <label>Client Secret</label>
              <input id="f-oauth-secret" type="password" placeholder="••••••••"/>
            </div>
          </div>
          <div id="tenant-row" class="form-group" style="display:none">
            <label>Tenant ID <span style="color:#64748b;font-weight:400">(or "common")</span></label>
            <input id="f-oauth-tenantid" placeholder="common"/>
          </div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <button id="btn-oauth-connect" class="btn-primary" onclick="startOAuth()">🔗 Connect &amp; get Refresh Token</button>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>Refresh Token <span style="color:#64748b;font-weight:400">(auto-filled after Connect, or paste manually)</span></label>
            <input id="f-oauth-refresh" placeholder="1//0g…"/>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveAccount()">Save Account</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let config = { default: '', accounts: {} };
    let currentProvider = 'generic';
    let qlProvider = 'generic';

    const PRESETS = {
      generic:   { imapHost: '',                        imapPort: 993, smtpHost: '',                       smtpPort: 465 },
      gmail:     { imapHost: 'imap.gmail.com',          imapPort: 993, smtpHost: 'smtp.gmail.com',         smtpPort: 465 },
      office365: { imapHost: 'outlook.office365.com',   imapPort: 993, smtpHost: 'smtp.office365.com',     smtpPort: 587 },
      exchange:  { imapHost: 'outlook.office365.com',   imapPort: 993, smtpHost: 'smtp.office365.com',     smtpPort: 587 },
    };

    // ── Provider detection for Quick Login ──────────────────────────────────
    const GMAIL_DOMAINS    = ['gmail.com','googlemail.com'];
    const O365_DOMAINS     = ['outlook.com','hotmail.com','live.com','msn.com'];

    function detectProvider(email) {
      const domain = (email.split('@')[1] || '').toLowerCase();
      const notice  = document.getElementById('ql-notice');
      const oauthSec= document.getElementById('ql-oauth-section');
      const passLbl = document.getElementById('ql-pass-label');
      const oauthBtn= document.getElementById('ql-oauth-btn');
      const titleEl = document.getElementById('ql-oauth-title');
      const helpEl  = document.getElementById('ql-oauth-help');
      const tenantRow = document.getElementById('ql-tenant-row');

      if (GMAIL_DOMAINS.includes(domain)) {
        qlProvider = 'gmail';
        notice.style.display = '';
        notice.innerHTML =
          '<strong>Gmail detected</strong> — Google blocks regular passwords for IMAP/SMTP.<br>' +
          '✅ <strong>Option A (easiest):</strong> Create an <a href="https://myaccount.google.com/apppasswords" target="_blank">App Password</a> ' +
          '(requires 2-Step Verification) and enter it in the password field below.<br>' +
          '✅ <strong>Option B:</strong> Use OAuth2 with your own Google Cloud credentials (see below).';
        passLbl.textContent = 'App Password';
        oauthSec.style.display = '';
        titleEl.textContent = 'Sign in with Google (OAuth2)';
        helpEl.href = 'https://console.cloud.google.com/apis/credentials';
        helpEl.textContent = 'Create Google OAuth2 credentials →';
        oauthBtn.className = 'btn-google';
        oauthBtn.innerHTML = \`<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg> Sign in with Google\`;
        tenantRow.style.display = 'none';

      } else if (O365_DOMAINS.includes(domain)) {
        qlProvider = 'office365';
        notice.style.display = '';
        notice.innerHTML =
          '<strong>Microsoft account detected</strong> — Microsoft has disabled basic auth for personal Outlook/Hotmail accounts.<br>' +
          '✅ Use OAuth2 below to sign in directly with your Microsoft account.';
        passLbl.textContent = 'Password (if basic auth is enabled by admin)';
        oauthSec.style.display = '';
        titleEl.textContent = 'Sign in with Microsoft (OAuth2)';
        helpEl.href = 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade';
        helpEl.textContent = 'Create Azure AD credentials →';
        oauthBtn.className = 'btn-microsoft';
        oauthBtn.innerHTML = \`<svg width="18" height="18" viewBox="0 0 18 18">
          <rect width="8.5" height="8.5" fill="#F35325"/>
          <rect x="9.5" width="8.5" height="8.5" fill="#81BC06"/>
          <rect y="9.5" width="8.5" height="8.5" fill="#05A6F0"/>
          <rect x="9.5" y="9.5" width="8.5" height="8.5" fill="#FFBA08"/>
        </svg> Sign in with Microsoft\`;
        tenantRow.style.display = '';

      } else {
        qlProvider = 'generic';
        notice.style.display = 'none';
        oauthSec.style.display = 'none';
        passLbl.textContent = 'Password';
      }
    }

    // ── Quick Login (password / App Password flow) ───────────────────────────
    async function quickLogin() {
      const email    = document.getElementById('ql-email').value.trim();
      const password = document.getElementById('ql-pass').value;
      const name     = document.getElementById('ql-name').value.trim();
      const type     = document.getElementById('ql-type').value.trim();
      if (!email || !password) { setStatus('Enter email and password first.', true); return; }

      const btn = document.getElementById('ql-btn');
      btn.textContent = 'Detecting…'; btn.disabled = true;
      setStatus('🔍 Looking up server settings…');

      try {
        const disc = await fetch('/api/autodiscover', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email }),
        }).then(r => r.json());

        if (!disc.imap) { setStatus('Could not detect server settings. Use Advanced Setup.', true); return; }
        setStatus(\`✅ Found: \${disc.imap.host} — Testing connection…\`);

        const test = await fetch('/api/test-connection', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email, password, imap: disc.imap }),
        }).then(r => r.json());

        if (!test.ok) { setStatus(\`❌ Login failed: \${test.error}\`, true); return; }
        setStatus('✅ Connection successful — saving account…');

        const key = emailToKey(email);
        config.accounts[key] = {
          name: name || email,
          ...(type ? {type} : {}),
          provider: disc.provider,
          imap: { host: disc.imap.host, port: disc.imap.port, user: email, password, tls: disc.imap.tls },
          smtp: { host: disc.smtp.host, port: disc.smtp.port, user: email, password, tls: disc.smtp.tls },
        };
        if (!config.default) config.default = key;
        await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(config) });
        await loadConfig();

        ['ql-email','ql-pass','ql-name','ql-type'].forEach(id => document.getElementById(id).value = '');
        detectProvider('');
        setStatus('');
        showToast(\`Account "\${name || email}" added ✓\`);
      } catch (e) {
        setStatus('Error: ' + e.message, true);
      } finally {
        btn.textContent = 'Connect →'; btn.disabled = false;
      }
    }

    // ── Quick OAuth2 flow ────────────────────────────────────────────────────
    async function quickOAuthConnect() {
      const email    = document.getElementById('ql-email').value.trim();
      const clientId = document.getElementById('ql-oauth-clientid').value.trim();
      const secret   = document.getElementById('ql-oauth-secret').value.trim();
      const tenantId = document.getElementById('ql-oauth-tenantid').value.trim() || 'common';
      const name     = document.getElementById('ql-name').value.trim();
      const type     = document.getElementById('ql-type').value.trim();

      if (!email)             { setStatus('Enter your email address first.', true); return; }
      if (!clientId || !secret) { setStatus('Enter Client ID and Client Secret first.', true); return; }

      const btn = document.getElementById('ql-oauth-btn');
      btn.disabled = true;
      setStatus('🔍 Discovering server settings…');

      try {
        const disc = await fetch('/api/autodiscover', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email }),
        }).then(r => r.json());

        if (!disc.imap) { setStatus('Could not detect server settings. Try Advanced Setup.', true); btn.disabled = false; return; }

        const res = await fetch('/oauth2/start-quick', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ email, name, type, provider: qlProvider, clientId, clientSecret: secret, tenantId, settings: disc }),
        }).then(r => r.json());

        if (res.error) { setStatus('Error: ' + res.error, true); btn.disabled = false; return; }

        window.open(res.url, '_blank', 'width=600,height=700');
        setStatus('🔐 Sign in in the popup window, then return here…');

        // Poll for completion
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          if (attempts > 90) { clearInterval(poll); setStatus('Timed out. Please try again.', true); btn.disabled = false; return; }
          const check = await fetch('/oauth2/token-ready').then(r => r.json()).catch(() => ({}));
          if (check.accountKey) {
            clearInterval(poll);
            btn.disabled = false;
            ['ql-email','ql-name','ql-type','ql-oauth-clientid','ql-oauth-secret','ql-oauth-tenantid'].forEach(id => document.getElementById(id).value = '');
            detectProvider('');
            setStatus('');
            await loadConfig();
            showToast('Account connected with OAuth2 ✓');
          }
        }, 2000);

      } catch (e) {
        setStatus('Error: ' + e.message, true);
        btn.disabled = false;
      }
    }

    function emailToKey(email) {
      return email.split('@')[0].replace(/[^a-z0-9]/gi,'_').toLowerCase()
           + '_' + email.split('@')[1].split('.')[0];
    }

    function setStatus(msg, error=false) {
      const el = document.getElementById('ql-status');
      el.textContent = msg;
      el.style.color = error ? '#f87171' : '#64748b';
    }

    // ── Config load/save ─────────────────────────────────────────────────────
    async function loadConfig() {
      config = await fetch('/api/config').then(r => r.json());
      render();
      const params = new URLSearchParams(location.search);
      if (params.get('refresh_token')) {
        document.getElementById('f-oauth-refresh').value = params.get('refresh_token');
        history.replaceState({}, '', '/');
        showToast('OAuth2 refresh token received ✓');
      }
    }

    async function saveConfig() {
      const res = await fetch('/api/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(config) });
      res.ok ? showToast('Saved ✓') : showToast('Save failed', true);
    }

    // ── Advanced Modal ───────────────────────────────────────────────────────
    function selectProvider(p) {
      currentProvider = p;
      ['generic','gmail','office365','exchange'].forEach(x => {
        document.getElementById('tab-'+x).classList.toggle('active', x === p);
      });
      document.getElementById('oauth-hint-gmail').style.display    = p === 'gmail'     ? '' : 'none';
      document.getElementById('oauth-hint-office365').style.display= p === 'office365' ? '' : 'none';
      document.getElementById('oauth2-section').style.display      = p !== 'generic'   ? '' : 'none';
      document.getElementById('tenant-row').style.display          = (p === 'office365' || p === 'exchange') ? '' : 'none';
      const pr = PRESETS[p];
      if (pr.imapHost) {
        document.getElementById('f-imap-host').value = pr.imapHost;
        document.getElementById('f-imap-port').value = pr.imapPort;
        document.getElementById('f-smtp-host').value = pr.smtpHost;
        document.getElementById('f-smtp-port').value = pr.smtpPort;
        document.getElementById('f-smtp-tls').checked = pr.smtpPort !== 587;
      }
      document.getElementById('btn-oauth-connect').textContent = p === 'gmail'
        ? '🔗 Connect with Google'
        : '🔗 Connect with Microsoft';
    }

    function render() {
      const el = document.getElementById('accounts-list');
      const keys = Object.keys(config.accounts);
      if (!keys.length) {
        el.innerHTML = '<div class="card empty">No accounts yet — add one above.</div>';
        return;
      }
      el.innerHTML = keys.map(key => {
        const acc = config.accounts[key];
        const isDefault = key === config.default;
        const prov = acc.provider || 'generic';
        const oauthBadge = acc.oauth2?.refreshToken ? '<span class="badge" style="background:#14532d;color:#4ade80">OAuth2 ✓</span>' : '';
        return \`<div class="card">
          <div class="card-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="card-title">\${acc.name||key}</span>
              <span class="badge">\${key}</span>
              \${acc.type ? \`<span class="badge">\${acc.type}</span>\` : ''}
              <span class="badge \${prov}">\${prov}</span>
              \${oauthBadge}
              \${isDefault ? '<span class="badge default">default</span>' : ''}
            </div>
            <div class="actions">
              \${!isDefault ? \`<button class="btn-ghost" onclick="setDefault('\${key}')">Default</button>\` : ''}
              <button class="btn-ghost" onclick="editAccount('\${key}')">Edit</button>
              <button class="btn-danger" onclick="deleteAccount('\${key}')">Delete</button>
            </div>
          </div>
          <div class="info-grid">
            <div>IMAP</div><div><span>\${acc.imap.user}</span> @ \${acc.imap.host}:\${acc.imap.port}</div>
            <div>SMTP</div><div><span>\${acc.smtp.user}</span> @ \${acc.smtp.host}:\${acc.smtp.port}</div>
          </div>
        </div>\`;
      }).join('');
    }

    function openModal(key) {
      const isEdit = !!key;
      document.getElementById('modal-title').textContent = isEdit ? 'Edit Account' : 'Add Account';
      document.getElementById('editing-key').value = key||'';
      document.getElementById('f-key').disabled = isEdit;

      if (isEdit) {
        const acc = config.accounts[key];
        const p = acc.provider || 'generic';
        selectProvider(p);
        document.getElementById('f-key').value   = key;
        document.getElementById('f-name').value  = acc.name||'';
        document.getElementById('f-type').value  = acc.type||'';
        document.getElementById('f-imap-host').value  = acc.imap.host;
        document.getElementById('f-imap-port').value  = acc.imap.port;
        document.getElementById('f-imap-user').value  = acc.imap.user;
        document.getElementById('f-imap-pass').value  = acc.imap.password||'';
        document.getElementById('f-imap-tls').checked = acc.imap.tls;
        document.getElementById('f-smtp-host').value  = acc.smtp.host;
        document.getElementById('f-smtp-port').value  = acc.smtp.port;
        document.getElementById('f-smtp-user').value  = acc.smtp.user;
        document.getElementById('f-smtp-pass').value  = acc.smtp.password||'';
        document.getElementById('f-smtp-tls').checked = acc.smtp.tls;
        document.getElementById('f-smtp-fromname').value = acc.smtp.fromName||'';
        document.getElementById('f-is-default').checked  = key === config.default;
        if (acc.oauth2) {
          document.getElementById('f-oauth-clientid').value = acc.oauth2.clientId||'';
          document.getElementById('f-oauth-secret').value   = acc.oauth2.clientSecret||'';
          document.getElementById('f-oauth-refresh').value  = acc.oauth2.refreshToken||'';
          document.getElementById('f-oauth-tenantid').value = acc.oauth2.tenantId||'';
        }
      } else {
        selectProvider('generic');
        document.getElementById('f-key').disabled = false;
        ['f-key','f-name','f-type','f-imap-host','f-imap-user','f-imap-pass',
         'f-smtp-host','f-smtp-user','f-smtp-pass','f-smtp-fromname',
         'f-oauth-clientid','f-oauth-secret','f-oauth-refresh','f-oauth-tenantid']
          .forEach(id => document.getElementById(id).value='');
        document.getElementById('f-imap-port').value = '993';
        document.getElementById('f-smtp-port').value = '465';
        document.getElementById('f-imap-tls').checked = true;
        document.getElementById('f-smtp-tls').checked = true;
        document.getElementById('f-is-default').checked = !Object.keys(config.accounts).length;
      }
      document.getElementById('modal').style.display = 'flex';
    }

    function closeModal() { document.getElementById('modal').style.display='none'; }
    function editAccount(key) { openModal(key); }

    function saveAccount() {
      const key = document.getElementById('f-key').value.trim();
      if (!key) { showToast('Account key required', true); return; }
      const typeVal  = document.getElementById('f-type').value.trim();
      const clientId = document.getElementById('f-oauth-clientid').value.trim();
      const secret   = document.getElementById('f-oauth-secret').value.trim();
      const refresh  = document.getElementById('f-oauth-refresh').value.trim();
      const tenantId = document.getElementById('f-oauth-tenantid').value.trim();
      const hasOAuth = clientId && secret && refresh;

      config.accounts[key] = {
        name: document.getElementById('f-name').value.trim()||key,
        ...(typeVal ? {type: typeVal} : {}),
        provider: currentProvider,
        ...(hasOAuth ? { oauth2: { clientId, clientSecret: secret, refreshToken: refresh, ...(tenantId ? {tenantId} : {}) } } : {}),
        imap: {
          host: document.getElementById('f-imap-host').value.trim(),
          port: Number(document.getElementById('f-imap-port').value),
          user: document.getElementById('f-imap-user').value.trim(),
          password: document.getElementById('f-imap-pass').value,
          tls: document.getElementById('f-imap-tls').checked,
        },
        smtp: {
          host: document.getElementById('f-smtp-host').value.trim(),
          port: Number(document.getElementById('f-smtp-port').value),
          user: document.getElementById('f-smtp-user').value.trim(),
          password: document.getElementById('f-smtp-pass').value,
          tls: document.getElementById('f-smtp-tls').checked,
          fromName: document.getElementById('f-smtp-fromname').value.trim()||undefined,
        },
      };
      if (document.getElementById('f-is-default').checked || !config.default) config.default = key;
      closeModal(); render(); saveConfig();
    }

    function deleteAccount(key) {
      if (!confirm(\`Delete "\${key}"?\`)) return;
      delete config.accounts[key];
      if (config.default===key) config.default = Object.keys(config.accounts)[0]||'';
      render(); saveConfig();
    }
    function setDefault(key) { config.default=key; render(); saveConfig(); }

    async function startOAuth() {
      const clientId = document.getElementById('f-oauth-clientid').value.trim();
      const secret   = document.getElementById('f-oauth-secret').value.trim();
      const tenantId = document.getElementById('f-oauth-tenantid').value.trim()||'common';
      if (!clientId||!secret) { showToast('Enter Client ID and Secret first', true); return; }
      const res = await fetch('/oauth2/start', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ provider: currentProvider, clientId, clientSecret: secret, tenantId }),
      });
      const { url } = await res.json();
      window.open(url, '_blank', 'width=600,height=700');
      showToast('Complete the sign-in in the popup, then return here.');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 60) { clearInterval(poll); return; }
        const check = await fetch('/oauth2/token-ready').then(r=>r.json()).catch(()=>({}));
        if (check.refreshToken && !check.accountKey) {
          clearInterval(poll);
          document.getElementById('f-oauth-refresh').value = check.refreshToken;
          showToast('OAuth2 connected ✓');
        }
      }, 2000);
    }

    function showToast(msg, error=false) {
      const t = document.getElementById('toast');
      t.textContent=msg; t.className='toast show'+(error?' error':'');
      setTimeout(()=>t.className='toast',2800);
    }

    document.getElementById('modal').addEventListener('click', function(e){ if(e.target===this) closeModal(); });
    loadConfig();
  </script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────

// Pending OAuth2 token (set when callback arrives, picked up by polling)
// accountKey is set when the quick-flow auto-saves the account
let pendingToken: { refreshToken: string; accountKey?: string } | null = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // ── Static HTML ──
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
    return;
  }

  // ── Config API ──
  if (req.method === "GET" && url.pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readConfig(), null, 2));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/config") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      try { writeConfig(JSON.parse(body)); res.writeHead(200); res.end("{}"); }
      catch { res.writeHead(400); res.end("bad json"); }
    });
    return;
  }

  // ── Auto-discover ──
  if (req.method === "POST" && url.pathname === "/api/autodiscover") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { email } = JSON.parse(body);
        const settings = await discoverSettings(email);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(settings ?? {}));
      } catch (e: any) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Test connection ──
  if (req.method === "POST" && url.pathname === "/api/test-connection") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const { email, password, imap } = JSON.parse(body);
        const client = new ImapFlow({
          host: imap.host, port: imap.port, secure: imap.tls,
          auth: { user: email, pass: password },
          logger: false,
        });
        await client.connect();
        await client.logout();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── OAuth2: start quick flow (auto-discovers settings, auto-saves account on callback) ──
  if (req.method === "POST" && url.pathname === "/oauth2/start-quick") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { email, name, type, provider, clientId, clientSecret, tenantId, settings } = JSON.parse(body);
        const state = Math.random().toString(36).slice(2);
        oauthState.set(state, {
          provider, clientId, clientSecret, tenantId,
          quickEmail: email, quickName: name, quickType: type, quickSettings: settings,
        });
        const authUrl = provider === "gmail"
          ? getGoogleAuthUrl(clientId, REDIRECT_URI, state)
          : getMicrosoftAuthUrl(clientId, REDIRECT_URI, tenantId ?? "common", state);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: authUrl }));
      } catch (e: any) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── OAuth2: start flow ──
  if (req.method === "POST" && url.pathname === "/oauth2/start") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { provider, clientId, clientSecret, tenantId } = JSON.parse(body);
        const state = Math.random().toString(36).slice(2);
        oauthState.set(state, { provider, clientId, clientSecret: clientSecret, tenantId });
        const authUrl = provider === "gmail"
          ? getGoogleAuthUrl(clientId, REDIRECT_URI, state)
          : getMicrosoftAuthUrl(clientId, REDIRECT_URI, tenantId, state);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: authUrl }));
      } catch (e: any) {
        res.writeHead(500); res.end(e.message);
      }
    });
    return;
  }

  // ── OAuth2: callback ──
  if (req.method === "GET" && url.pathname === "/oauth2/callback") {
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const info  = state ? oauthState.get(state) : null;

    if (!code || !info) {
      res.writeHead(400); res.end("Missing code or state"); return;
    }

    try {
      const { accessToken, refreshToken } = info.provider === "gmail"
        ? await exchangeGoogleCode(code, info.clientId, info.clientSecret, REDIRECT_URI)
        : await exchangeMicrosoftCode(code, info.clientId, info.clientSecret, REDIRECT_URI, info.tenantId);

      oauthState.delete(state!);

      // Quick-flow: auto-save the account
      if (info.quickEmail && info.quickSettings) {
        const email = info.quickEmail;
        const disc  = info.quickSettings;
        const key   = email.split("@")[0].replace(/[^a-z0-9]/gi, "_").toLowerCase()
                    + "_" + email.split("@")[1].split(".")[0];
        const cfg   = readConfig();
        cfg.accounts[key] = {
          name: info.quickName || email,
          ...(info.quickType ? { type: info.quickType } : {}),
          provider: info.provider as any,
          oauth2: {
            clientId: info.clientId,
            clientSecret: info.clientSecret,
            refreshToken,
            ...(info.tenantId && info.tenantId !== "common" ? { tenantId: info.tenantId } : {}),
          },
          imap: { host: disc.imap.host, port: disc.imap.port, user: email, password: "", tls: disc.imap.tls },
          smtp: { host: disc.smtp.host, port: disc.smtp.port, user: email, password: "", tls: disc.smtp.tls },
        };
        if (!cfg.default) cfg.default = key;
        writeConfig(cfg);
        pendingToken = { refreshToken, accountKey: key };
      } else {
        pendingToken = { refreshToken };
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f1117;color:#e2e8f0;padding:40px;text-align:center">
        <h2>✅ Connected!</h2><p>Your account has been saved. You can close this window.</p>
        <script>window.close();</script></body></html>`);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h2>OAuth2 Error</h2><pre>${e.message}</pre>`);
    }
    return;
  }

  // ── OAuth2: poll for pending token ──
  if (req.method === "GET" && url.pathname === "/oauth2/token-ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (pendingToken) {
      res.end(JSON.stringify(pendingToken));
      pendingToken = null;
    } else {
      res.end("{}");
    }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n📬 IMAP MCP Config UI → ${url}\n`);
  try { execSync(`open "${url}"`); }
  catch { try { execSync(`xdg-open "${url}"`); } catch {} }
});
