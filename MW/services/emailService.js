// services/emailService.js
//
// Central email service for the IMS backend.
//
// Notifications exposed (all fire-and-forget — SMTP failures are logged
// and swallowed so they never break the HTTP request that triggered them):
//
//   • notifyDepartmentHeadsOfNewRequest — DH queue (pre-existing)
//   • notifyAdminsOfPOImport            — PO/PR import success
//   • notifyRequesterOfSTSRejection     — STS rejected by DH
//   • notifyOfSTSApproval               — STS approved by DH
//   • notifyRequesterOfSTSTransfer      — STS shipped / In-Transit
//   • notifyOfSTSReceipt                — STS received at destination
//
// Each notification shares one responsive shell (see renderShell), one
// item table renderer, one info-card renderer. Only the theme tokens and
// content differ. Themes are declared in THEMES.
//
// Env vars used:
//   EMAIL_HOST       — SMTP host
//   EMAIL            — SMTP auth user AND default From address
//   EMAIL_PASSWORD   — SMTP auth password
//   EMAIL_PORT       — optional; defaults to 25
//   EMAIL_SECURE     — optional; 'true' for implicit TLS (port 465)
//   FRONTEND_URL     — used to build the CTA link

const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10) || 25,
  secure: String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true',
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

const FRONTEND_URL  = process.env.FRONTEND_URL || 'http://localhost:5173';
const DASHBOARD_URL = `${FRONTEND_URL}/admin`;

// ---------------------------------------------------------------------------
// Themes — each notification has its own color identity.
//
// `gradient`   — header bar background
// `accent`     — CTA button background, links
// `badgeBg`    — pill background in header
// `badgeFg`    — pill text
// `subColor`   — secondary text in header (badge area)
// ---------------------------------------------------------------------------
const THEMES = Object.freeze({
  PO_IMPORT: {
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    accent:   '#1d4ed8',
    badgeBg:  '#dbeafe',
    badgeFg:  '#1e40af',
    subColor: '#bfdbfe',
  },
  STS_REJECTED: {
    gradient: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
    accent:   '#b91c1c',
    badgeBg:  '#fee2e2',
    badgeFg:  '#991b1b',
    subColor: '#fecaca',
  },
  STS_APPROVED: {
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    accent:   '#059669',
    badgeBg:  '#d1fae5',
    badgeFg:  '#065f46',
    subColor: '#a7f3d0',
  },
  STS_TRANSFERRED: {
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
    accent:   '#4338ca',
    badgeBg:  '#e0e7ff',
    badgeFg:  '#3730a3',
    subColor: '#c7d2fe',
  },
  STS_RECEIVED: {
    gradient: 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)',
    accent:   '#0f766e',
    badgeBg:  '#ccfbf1',
    badgeFg:  '#0f766e',
    subColor: '#99f6e4',
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const fmtDateTime = (value) => {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return String(value);
  }
};

const stsLabel = (stsNo) => stsNo || 'STS No. ?';

// ---------------------------------------------------------------------------
// Shell — the responsive HTML wrapper.
//
// At ≤ 600px:
//   • container loses radius (full-bleed)
//   • padding tightens
//   • FROM/TO card stacks with a ↓ arrow
//   • item rows stack (code above qty)
//   • CTA button goes full-width
//   • body text bumps to 15–16px so iOS Safari doesn't auto-zoom
// ---------------------------------------------------------------------------
const renderShell = ({
  theme,
  badgeText,
  preheader,
  title,
  subtitle,
  bodyHtml,
  ctaText,
  ctaUrl,
  footerNote,
}) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(title)}</title>
<style>
  @media (max-width: 600px) {
    .ims-container  { width: 100% !important; border-radius: 0 !important; }
    .ims-px         { padding-left: 18px !important; padding-right: 18px !important; }
    .ims-stack      { display: block !important; width: 100% !important; padding: 14px 12px !important; }
    .ims-arrow      { display: none !important; }
    .ims-arrow-mob  { display: block !important; text-align: center !important; padding: 4px 0 !important; font-size: 18px !important; font-weight: 800 !important; }
    .ims-cta-btn    { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; padding: 15px 20px !important; font-size: 16px !important; }
    .ims-h1         { font-size: 20px !important; }
    .ims-body-text  { font-size: 16px !important; }
    .ims-label      { font-size: 11px !important; }
    .ims-value      { font-size: 15px !important; }
    .ims-value-lg   { font-size: 18px !important; }
    .ims-footer-txt { font-size: 12px !important; }
    .ims-item-row   { display: block !important; width: 100% !important; padding: 10px 0 !important; border-bottom: 1px dashed #e2e8f0 !important; }
    .ims-item-row:last-child { border-bottom: none !important; }
    .ims-item-qty   { text-align: left !important; padding-top: 4px !important; }
  }
  .ims-arrow-mob { display: none; mso-hide: all; }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;">
    ${esc(preheader || title)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <table role="presentation" class="ims-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.08);">

          <!-- Header bar -->
          <tr>
            <td class="ims-px" style="background:${theme.accent};background-image:${theme.gradient};padding:22px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.04em;">
                    IMS
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${theme.badgeBg};color:${theme.badgeFg};font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                      ${esc(badgeText)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td class="ims-px" style="padding:28px 28px 8px 28px;">
              <h1 class="ims-h1" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#0f172a;font-weight:800;letter-spacing:-0.01em;">
                ${esc(title)}
              </h1>
              ${subtitle ? `<p class="ims-body-text" style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#475569;">${subtitle}</p>` : ''}
            </td>
          </tr>

          ${bodyHtml}

          <!-- CTA -->
          <tr>
            <td class="ims-px" align="center" style="padding:26px 28px 12px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:320px;">
                <tr>
                  <td align="center" style="background:${theme.accent};border-radius:10px;">
                    <a href="${esc(ctaUrl)}" class="ims-cta-btn" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:0.03em;">
                      ${esc(ctaText)} &#8594;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="ims-px" style="padding:24px 28px 28px 28px;border-top:1px solid #f1f5f9;">
              <p class="ims-footer-txt" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#94a3b8;">
                ${footerNote}
              </p>
              <p class="ims-footer-txt" style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#94a3b8;">
                Lepanto Consolidated Mining Company · IMS
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Shared body blocks
// ---------------------------------------------------------------------------

// Renders a colored info card (used for "Reference No." blocks)
const infoCard = ({ label, value, bg, border, labelColor, valueColor, mono = true }) => `
  <tr>
    <td class="ims-px" style="padding:16px 28px 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};border:1px solid ${border};border-radius:10px;">
        <tr>
          <td style="padding:12px 16px;">
            <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;color:${labelColor};text-transform:uppercase;letter-spacing:0.06em;">
              ${esc(label)}
            </div>
            <div class="ims-value" style="font-family:${mono ? "'Courier New',Courier,monospace" : 'Arial,Helvetica,sans-serif'};font-size:16px;font-weight:800;color:${valueColor};margin-top:2px;">
              ${value}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

// Renders a FROM → TO card
const routeCard = ({ fromLabel, toLabel }) => `
  <tr>
    <td class="ims-px" style="padding:16px 28px 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;">
        <tr>
          <td class="ims-stack" width="45%" align="center" style="padding:16px 12px;">
            <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:800;color:#0f766e;text-transform:uppercase;letter-spacing:0.08em;">
              From
            </div>
            <div class="ims-value-lg" style="font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:800;color:#0f172a;margin-top:4px;">
              ${esc(fromLabel)}
            </div>
          </td>
          <td class="ims-arrow" width="10%" align="center" style="font-size:20px;color:#0f766e;font-weight:800;">
            &#8594;
          </td>
          <td class="ims-stack" width="45%" align="center" style="padding:16px 12px;">
            <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:800;color:#0f766e;text-transform:uppercase;letter-spacing:0.08em;">
              To
            </div>
            <div class="ims-value-lg" style="font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:800;color:#0f172a;margin-top:4px;">
              ${esc(toLabel)}
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="3" style="padding:0;">
            <div class="ims-arrow-mob">&#8595;</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

// Renders a list of items (1..N)
const itemsCard = (items) => {
  if (!Array.isArray(items) || items.length === 0) return '';
  const rows = items.map((it) => `
    <tr>
      <td class="ims-item-row" style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:top;min-width:0;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:800;color:#4338ca;line-height:1.2;">
                ${esc(it.itemCode)}
              </div>
              ${it.itemName ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#475569;margin-top:2px;line-height:1.4;">${esc(it.itemName)}</div>` : ''}
              ${it.locatorCode ? `<div style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#0f766e;margin-top:4px;">→ ${esc(it.locatorCode)}</div>` : ''}
            </td>
            <td class="ims-item-qty" align="right" style="vertical-align:top;white-space:nowrap;padding-left:12px;">
              <div style="font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:800;color:#0f172a;">
                ${esc(it.qty)}${it.uom ? ` <span style="font-size:12px;color:#64748b;">${esc(it.uom)}</span>` : ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  return `
  <tr>
    <td class="ims-px" style="padding:20px 28px 0 28px;">
      <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
        Item${items.length === 1 ? '' : 's'} (${items.length})
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
        ${rows}
      </table>
    </td>
  </tr>`;
};

// Renders a key/value grid
const infoGrid = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cells = rows.map((r) => `
    <tr>
      <td style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">
          ${esc(r.label)}
        </div>
        <div class="ims-value" style="font-family:${r.mono ? "'Courier New',Courier,monospace" : 'Arial,Helvetica,sans-serif'};font-size:13.5px;font-weight:700;color:${r.color || '#0f172a'};margin-top:2px;word-break:break-word;">
          ${esc(r.value || '—')}
        </div>
      </td>
    </tr>
    <tr><td style="height:6px;line-height:6px;">&nbsp;</td></tr>`).join('');

  return `
  <tr>
    <td class="ims-px" style="padding:16px 28px 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${cells}
      </table>
    </td>
  </tr>`;
};

// A tinted reason / remarks / message box
const reasonBox = ({ title, body, bg, border, titleColor, bodyColor }) => `
  <tr>
    <td class="ims-px" style="padding:16px 28px 0 28px;">
      <div class="ims-label" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">
        ${esc(title)}
      </div>
      <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${bodyColor};white-space:pre-wrap;">
        ${esc(body)}
      </div>
    </td>
  </tr>`;

// ---------------------------------------------------------------------------
// Dispatch — fires to every recipient, logs outcomes, never throws.
// ---------------------------------------------------------------------------
const dispatch = async ({ label, recipients, subject, html, text, replyTo }) => {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.warn(`📧 ${label}: no recipients — nothing sent.`);
    return;
  }

  const fromAddress = `"IMS Notifications" <${process.env.EMAIL}>`;

  const results = await Promise.allSettled(
    recipients.map(async (r) => {
      const to = String(r.email || '').trim();
      if (!to) throw new Error(`User "${r.username || '?'}" has no email address.`);

      await transporter.sendMail({
        from:    fromAddress,
        to,
        replyTo: replyTo || undefined,
        subject,
        text,
        html,
      });
      return { username: r.username, email: to };
    })
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const recipient = recipients[i];
    if (r.status === 'fulfilled') {
      console.log(`📧 ${label} → ${recipient.email}`);
    } else {
      console.error(
        `📧 ${label} failed for ${recipient.email}:`,
        r.reason?.message || r.reason
      );
    }
  }
};

// ===========================================================================
// Notification 1 — DH new transfer request (pre-existing, refactored onto shell)
// ===========================================================================
const notifyDepartmentHeadsOfNewRequest = async (data) => {
  const {
    recipients = [],
    draftNo,
    submitter, submitterEmail,
    fromWarehouseCode, toWarehouseCode,
    itemCode, itemName, uom, qty, targetLocatorCode,
    remarks, submittedAt,
  } = data || {};

  const theme = THEMES.STS_TRANSFERRED;

  const subject = `[IMS] New Transfer Request — ${itemCode} × ${qty}${uom ? ' ' + uom : ''} from ${fromWarehouseCode} → ${toWarehouseCode}`;

  const bodyHtml = [
    infoCard({
      label: 'Reference No.', value: esc(draftNo),
      bg: '#eef2ff', border: '#c7d2fe',
      labelColor: '#4338ca', valueColor: '#1e1b4b',
    }),
    routeCard({ fromLabel: fromWarehouseCode, toLabel: toWarehouseCode }),
    itemsCard([{ itemCode, itemName, qty, uom, locatorCode: targetLocatorCode }]),
    remarks ? reasonBox({
      title: 'Remarks',
      body: remarks,
      bg: '#fffbeb', border: '#fde68a',
      titleColor: '#92400e', bodyColor: '#78350f',
    }) : '',
    infoGrid([
      { label: 'Requested by', value: submitter, mono: true },
      { label: 'Submitted',    value: fmtDateTime(submittedAt), mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'Action Required',
    preheader: `New transfer request from ${submitter} — ${itemCode} × ${qty} — awaiting your approval.`,
    title: 'New Transfer Request',
    subtitle: 'A new stock transfer request has been submitted and is awaiting your approval.',
    bodyHtml,
    ctaText: 'Review in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you hold the <strong style="color:#475569;">Department Head</strong> role in IMS. This is an automated message — please do not reply directly.',
  });

  const text = [
    'NEW TRANSFER REQUEST — Action Required',
    '',
    `Reference No.:   ${draftNo}`,
    `From warehouse:  ${fromWarehouseCode}`,
    `To warehouse:    ${toWarehouseCode}`,
    `Item Code:       ${itemCode}`,
    itemName ? `Item Name:       ${itemName}` : '',
    `Quantity:        ${qty}${uom ? ' ' + uom : ''}`,
    `Target Locator:  ${targetLocatorCode}`,
    `Requested by:    ${submitter}`,
    `Submitted at:    ${fmtDateTime(submittedAt)}`,
    remarks ? `\nRemarks:\n${remarks}` : '',
    '',
    `Review in IMS: ${DASHBOARD_URL}`,
  ].filter(Boolean).join('\n');

  await dispatch({
    label: 'DH notified (new request)',
    recipients,
    subject,
    html,
    text,
    replyTo: submitterEmail || undefined,
  });
};

// ===========================================================================
// Notification 2 — Admin + Super Admin on PO/PR import success
// ===========================================================================
const notifyAdminsOfPOImport = async (data) => {
  const {
    recipients = [],
    importedBy,
    importedAt,
    sourceFile,
    poCount, lineCount,
    withPoCount, withoutPoCount,
    warehouseCodes = [],
    lockedCount = 0,
    unlockedCount = 0,
    autoStoredCount = 0,
  } = data || {};

  const theme = THEMES.PO_IMPORT;

  const subject = `[IMS] PO/PR Import — ${lineCount} line${lineCount === 1 ? '' : 's'} across ${poCount} ${poCount === 1 ? 'record' : 'records'}`;

  const bodyHtml = [
    infoCard({
      label: 'Source file', value: esc(sourceFile || '—'),
      bg: '#eff6ff', border: '#bfdbfe',
      labelColor: '#1e40af', valueColor: '#1e3a8a',
      mono: false,
    }),
    infoGrid([
      { label: 'PO / PR records',  value: String(poCount), mono: true },
      { label: 'Total lines',      value: String(lineCount), mono: true },
      { label: 'With PO No.',      value: String(withPoCount), mono: true },
      { label: 'Without PO (PR)',  value: String(withoutPoCount), mono: true },
      { label: 'Auto-stored (locked)', value: String(autoStoredCount), mono: true },
      { label: 'Warehouses',       value: warehouseCodes.join(', '), mono: true },
      { label: 'Imported by',      value: importedBy, mono: true },
      { label: 'Imported at',      value: fmtDateTime(importedAt), mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'Import Complete',
    preheader: `PO/PR import: ${lineCount} line${lineCount === 1 ? '' : 's'} imported by ${importedBy}.`,
    title: 'Purchase Orders Imported',
    subtitle: 'A batch of PO/PR lines was successfully imported into IMS. No action is required — this is a receipt of the import.',
    bodyHtml,
    ctaText: 'View in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you hold the <strong style="color:#475569;">Admin</strong> or <strong style="color:#475569;">Super Admin</strong> role in IMS. This is an automated message — please do not reply directly.',
  });

  const text = [
    'PO/PR IMPORT COMPLETE',
    '',
    `Source file:       ${sourceFile || '—'}`,
    `PO / PR records:   ${poCount}`,
    `Total lines:       ${lineCount}`,
    `With PO No.:       ${withPoCount}`,
    `Without PO (PR):   ${withoutPoCount}`,
    `Auto-stored:       ${autoStoredCount}`,
    `Warehouses:        ${warehouseCodes.join(', ')}`,
    `Imported by:       ${importedBy}`,
    `Imported at:       ${fmtDateTime(importedAt)}`,
    '',
    `View in IMS: ${DASHBOARD_URL}`,
  ].join('\n');

  await dispatch({
    label: 'Admins notified (PO import)',
    recipients,
    subject,
    html,
    text,
  });
};

// ===========================================================================
// Notification 3 — Requester on STS rejection (RED)
// ===========================================================================
const notifyRequesterOfSTSRejection = async (data) => {
  const {
    recipients = [],
    stsId, stsNo,
    requester,
    rejectedBy, rejectedAt,
    rejectionReason,
    items = [],
    fromWarehouseCode, toWarehouseCode,
  } = data || {};

  const theme = THEMES.STS_REJECTED;

  const subject = `[IMS] Transfer Request REJECTED — ${stsLabel(stsNo)}`;

  const bodyHtml = [
    infoCard({
      label: 'STS No.', value: esc(stsLabel(stsNo)),
      bg: '#fee2e2', border: '#fecaca',
      labelColor: '#991b1b', valueColor: '#7f1d1d',
    }),
    routeCard({ fromLabel: fromWarehouseCode || '—', toLabel: toWarehouseCode || '—' }),
    itemsCard(items),
    rejectionReason ? reasonBox({
      title: 'Rejection reason',
      body: rejectionReason,
      bg: '#fef2f2', border: '#fecaca',
      titleColor: '#991b1b', bodyColor: '#7f1d1d',
    }) : '',
    infoGrid([
      { label: 'Rejected by', value: rejectedBy, mono: true },
      { label: 'Rejected at', value: fmtDateTime(rejectedAt), mono: true },
      { label: 'Requested by', value: requester, mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'Rejected',
    preheader: `Your transfer request ${stsLabel(stsNo)} was rejected.`,
    title: 'Transfer Request Rejected',
    subtitle: 'Your stock transfer request was reviewed and rejected by the Department Head. You may submit a new request with adjusted details.',
    bodyHtml,
    ctaText: 'View in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you submitted this transfer request in IMS. This is an automated message — please do not reply directly.',
  });

  const text = [
    'TRANSFER REQUEST REJECTED',
    '',
    `STS No.:     ${stsLabel(stsNo)}`,
    `From:        ${fromWarehouseCode || '—'}`,
    `To:          ${toWarehouseCode || '—'}`,
    '',
    `Rejected by: ${rejectedBy}`,
    `Rejected at: ${fmtDateTime(rejectedAt)}`,
    '',
    'Reason:',
    rejectionReason || '—',
    '',
    `View in IMS: ${DASHBOARD_URL}`,
  ].join('\n');

  await dispatch({
    label: 'Requester notified (rejection)',
    recipients,
    subject,
    html,
    text,
  });
};

// ===========================================================================
// Notification 4 — Requester + target handlers on STS approval (GREEN)
// ===========================================================================
const notifyOfSTSApproval = async (data) => {
  const {
    recipients = [],
    stsId, stsNo,
    requester,
    approvedBy, approvedAt,
    items = [],
    fromWarehouseCode, toWarehouseCode,
  } = data || {};

  const theme = THEMES.STS_APPROVED;

  const subject = `[IMS] Transfer Request APPROVED — ${stsLabel(stsNo)}`;

  const bodyHtml = [
    infoCard({
      label: 'STS No.', value: esc(stsLabel(stsNo)),
      bg: '#d1fae5', border: '#a7f3d0',
      labelColor: '#065f46', valueColor: '#064e3b',
    }),
    routeCard({ fromLabel: fromWarehouseCode || '—', toLabel: toWarehouseCode || '—' }),
    itemsCard(items),
    infoGrid([
      { label: 'Requested by', value: requester, mono: true },
      { label: 'Approved by',  value: approvedBy, mono: true },
      { label: 'Approved at',  value: fmtDateTime(approvedAt), mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'Approved',
    preheader: `Transfer ${stsLabel(stsNo)} approved. Source warehouse can now ship.`,
    title: 'Transfer Request Approved',
    subtitle: 'The Department Head has approved this transfer request. The source warehouse can now proceed to ship the items.',
    bodyHtml,
    ctaText: 'View in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you submitted this transfer request, or you are a Stock Handler at the source warehouse. This is an automated message — please do not reply directly.',
  });

  const text = [
    'TRANSFER REQUEST APPROVED',
    '',
    `STS No.:     ${stsLabel(stsNo)}`,
    `From:        ${fromWarehouseCode || '—'}`,
    `To:          ${toWarehouseCode || '—'}`,
    '',
    `Requested by: ${requester}`,
    `Approved by:  ${approvedBy}`,
    `Approved at:  ${fmtDateTime(approvedAt)}`,
    '',
    `View in IMS: ${DASHBOARD_URL}`,
  ].join('\n');

  await dispatch({
    label: 'Recipients notified (approval)',
    recipients,
    subject,
    html,
    text,
  });
};

// ===========================================================================
// Notification 5 — Requester on STS transferred (INDIGO)
// ===========================================================================
const notifyRequesterOfSTSTransfer = async (data) => {
  const {
    recipients = [],
    stsId, stsNo,
    requester,
    shippedBy, shippedAt,
    sourceLocatorCode,
    items = [],
    fromWarehouseCode, toWarehouseCode,
  } = data || {};

  const theme = THEMES.STS_TRANSFERRED;

  const subject = `[IMS] Transfer ${stsLabel(stsNo)} In-Transit — ${fromWarehouseCode} → ${toWarehouseCode}`;

  const bodyHtml = [
    infoCard({
      label: 'STS No.', value: esc(stsLabel(stsNo)),
      bg: '#e0e7ff', border: '#c7d2fe',
      labelColor: '#3730a3', valueColor: '#1e1b4b',
    }),
    routeCard({ fromLabel: fromWarehouseCode || '—', toLabel: toWarehouseCode || '—' }),
    itemsCard(items),
    sourceLocatorCode ? reasonBox({
      title: 'Source locator',
      body: sourceLocatorCode,
      bg: '#f0fdfa', border: '#99f6e4',
      titleColor: '#0f766e', bodyColor: '#0f766e',
    }) : '',
    infoGrid([
      { label: 'Requested by', value: requester, mono: true },
      { label: 'Transferred by', value: shippedBy, mono: true },
      { label: 'Transferred at', value: fmtDateTime(shippedAt), mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'In-Transit',
    preheader: `Transfer ${stsLabel(stsNo)} is now In-Transit.`,
    title: 'Transfer In-Transit',
    subtitle: 'The source warehouse has shipped the requested items. They are now in transit and you can confirm receipt once they arrive.',
    bodyHtml,
    ctaText: 'Track in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you submitted this transfer request in IMS. This is an automated message — please do not reply directly.',
  });

  const text = [
    'TRANSFER IN-TRANSIT',
    '',
    `STS No.:     ${stsLabel(stsNo)}`,
    `From:        ${fromWarehouseCode || '—'}`,
    `To:          ${toWarehouseCode || '—'}`,
    '',
    `Transferred by: ${shippedBy}`,
    `Transferred at: ${fmtDateTime(shippedAt)}`,
    sourceLocatorCode ? `Source locator: ${sourceLocatorCode}` : '',
    '',
    `Track in IMS: ${DASHBOARD_URL}`,
  ].filter(Boolean).join('\n');

  await dispatch({
    label: 'Requester notified (transferred)',
    recipients,
    subject,
    html,
    text,
  });
};

// ===========================================================================
// Notification 6 — DH + issuer on STS receipt (TEAL)
// ===========================================================================
const notifyOfSTSReceipt = async (data) => {
  const {
    recipients = [],
    stsId, stsNo,
    requester,
    receivedBy, receivedAt,
    receiveRemarks,
    items = [],
    fromWarehouseCode, toWarehouseCode,
  } = data || {};

  const theme = THEMES.STS_RECEIVED;

  const subject = `[IMS] Transfer ${stsLabel(stsNo)} Received at ${toWarehouseCode}`;

  const bodyHtml = [
    infoCard({
      label: 'STS No.', value: esc(stsLabel(stsNo)),
      bg: '#ccfbf1', border: '#99f6e4',
      labelColor: '#0f766e', valueColor: '#064e3b',
    }),
    routeCard({ fromLabel: fromWarehouseCode || '—', toLabel: toWarehouseCode || '—' }),
    itemsCard(items),
    receiveRemarks ? reasonBox({
      title: 'Receive remarks',
      body: receiveRemarks,
      bg: '#f0fdfa', border: '#99f6e4',
      titleColor: '#0f766e', bodyColor: '#0f766e',
    }) : '',
    infoGrid([
      { label: 'Requested by', value: requester, mono: true },
      { label: 'Received by',  value: receivedBy, mono: true },
      { label: 'Received at',  value: fmtDateTime(receivedAt), mono: true },
    ]),
  ].join('');

  const html = renderShell({
    theme,
    badgeText: 'Received',
    preheader: `Transfer ${stsLabel(stsNo)} has been received at ${toWarehouseCode}.`,
    title: 'Transfer Received',
    subtitle: 'The destination warehouse has confirmed receipt of the transferred items.',
    bodyHtml,
    ctaText: 'View in IMS',
    ctaUrl: DASHBOARD_URL,
    footerNote: 'You received this email because you hold the <strong style="color:#475569;">Department Head</strong> role, or you were the issuer of this transfer. This is an automated message — please do not reply directly.',
  });

  const text = [
    'TRANSFER RECEIVED',
    '',
    `STS No.:     ${stsLabel(stsNo)}`,
    `From:        ${fromWarehouseCode || '—'}`,
    `To:          ${toWarehouseCode || '—'}`,
    '',
    `Received by: ${receivedBy}`,
    `Received at: ${fmtDateTime(receivedAt)}`,
    receiveRemarks ? `\nRemarks:\n${receiveRemarks}` : '',
    '',
    `View in IMS: ${DASHBOARD_URL}`,
  ].filter(Boolean).join('\n');

  await dispatch({
    label: 'DH + issuer notified (received)',
    recipients,
    subject,
    html,
    text,
  });
};

module.exports = {
  transporter,
  notifyDepartmentHeadsOfNewRequest,
  notifyAdminsOfPOImport,
  notifyRequesterOfSTSRejection,
  notifyOfSTSApproval,
  notifyRequesterOfSTSTransfer,
  notifyOfSTSReceipt,
};