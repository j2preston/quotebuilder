import puppeteer from 'puppeteer';
import { formatGBP, formatDate } from '@quotebot/shared';

// ─── Input type ───────────────────────────────────────────────────────────────

export interface PdfQuoteData {
  // Quote
  id:            string;
  customerName:  string;
  status:        string;
  subtotal:      number;
  vatAmount:     number;
  total:         number;
  depositAmount: number;
  notes:         string | null;
  createdAt:     Date;
  lineItems: Array<{
    description: string;
    qty:         number;
    unitPrice:   number;
    total:       number;
    sortOrder:   number;
  }>;
  // Trader
  businessName:   string;
  traderName:     string;
  traderLocation: string;
  whatsappNumber: string | null;
  // Rate card
  vatRegistered:  boolean;
  depositPercent: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** QT-2026-A3F9B — derived from last 5 hex chars of UUID (no DB sequence needed) */
function quoteNumber(id: string, createdAt: Date): string {
  const year   = createdAt.getFullYear();
  const suffix = id.replace(/-/g, '').slice(-5).toUpperCase();
  return `QT-${year}-${suffix}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Rough heuristic: does the trader's location string suggest Scotland? */
function isScottish(location: string): boolean {
  const loc = location.toUpperCase();
  const cities   = ['EDINBURGH', 'GLASGOW', 'ABERDEEN', 'DUNDEE', 'INVERNESS', 'PERTH', 'STIRLING', 'FALKIRK'];
  const postcodes = ['EH', 'G', 'AB', 'DD', 'IV', 'KY', 'PH', 'FK', 'KA', 'KW', 'ML', 'PA', 'TD', 'DG', 'HS', 'ZE'];

  if (cities.some((c) => loc.includes(c))) return true;
  return postcodes.some((prefix) => new RegExp(`\\b${prefix}\\d`).test(loc));
}

// ─── HTML template ────────────────────────────────────────────────────────────

function buildHtml(d: PdfQuoteData): string {
  const qNum      = quoteNumber(d.id, d.createdAt);
  const quoteDate = formatDate(d.createdAt);
  const expiryDate = formatDate(addDays(d.createdAt, 30));
  const scottish  = isScottish(d.traderLocation);

  const sortedItems = [...d.lineItems].sort((a, b) => a.sortOrder - b.sortOrder);

  const rowsHtml = sortedItems
    .map(
      (li, i) => `
      <tr class="${i % 2 === 1 ? 'alt' : ''}">
        <td class="desc">${escHtml(li.description)}</td>
        <td class="num">${escHtml(li.qty)}</td>
        <td class="num">${formatGBP(li.unitPrice)}</td>
        <td class="num">${formatGBP(li.total)}</td>
      </tr>`,
    )
    .join('');

  const vatRow = d.vatRegistered
    ? `<tr class="summary-row">
         <td colspan="3">VAT (20%)</td>
         <td class="num">${formatGBP(d.vatAmount)}</td>
       </tr>`
    : '';

  const depositRow =
    d.depositAmount > 0
      ? `<tr class="summary-row">
           <td colspan="3">Deposit required to book (${d.depositPercent}%)</td>
           <td class="num">${formatGBP(d.depositAmount)}</td>
         </tr>`
      : '';

  const contactLine = d.whatsappNumber
    ? `<div class="trader-contact">WhatsApp: ${escHtml(d.whatsappNumber)}</div>`
    : '';

  const jobDescription = d.notes
    ? `<p class="job-desc">${escHtml(d.notes)}</p>`
    : '';

  const registrationNote = scottish
    ? `${escHtml(d.businessName)} · Registered in Scotland`
    : escHtml(d.businessName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page ── */
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    color: #1a1a2e;
    background: #fff;
    padding: 0;
  }
  .page { padding: 36px 40px; }

  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1E3A5F;
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  .business-name {
    font-size: 22px;
    font-weight: 700;
    color: #1E3A5F;
    margin-bottom: 6px;
  }
  .trader-contact {
    color: #4b5563;
    font-size: 12px;
    margin-top: 2px;
    line-height: 1.6;
  }
  .quote-meta { text-align: right; }
  .quote-label {
    font-size: 28px;
    font-weight: 800;
    color: #1E3A5F;
    letter-spacing: 2px;
    margin-bottom: 4px;
  }
  .quote-number {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }
  .meta-row { font-size: 12px; color: #6b7280; }

  /* ── Customer / job section ── */
  .customer-section {
    background: #F0F4F8;
    border-left: 4px solid #1E3A5F;
    padding: 14px 18px;
    margin-bottom: 24px;
    border-radius: 0 6px 6px 0;
  }
  .customer-label { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #6b7280; margin-bottom: 4px; }
  .customer-name  { font-size: 16px; font-weight: 700; color: #1E3A5F; margin-bottom: 6px; }
  .job-desc       { color: #374151; font-size: 12px; line-height: 1.6; }

  /* ── Line items table ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: #1E3A5F; }
  th {
    color: #fff;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .07em;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
  }
  th.num { text-align: right; }
  td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
  tr.alt td { background: #F9FAFB; }
  td.desc { color: #1a1a2e; }
  td.num { text-align: right; white-space: nowrap; }

  /* ── Summary rows ── */
  .summary-section { margin-top: 0; }
  .summary-section table { border-top: 2px solid #1E3A5F; }
  tr.summary-row td {
    padding: 7px 12px;
    border-bottom: 1px solid #e5e7eb;
    color: #374151;
  }
  tr.total-row td {
    background: #1E3A5F;
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    padding: 11px 12px;
    border-bottom: none;
  }

  /* ── Deposit callout ── */
  .deposit-box {
    margin-top: 20px;
    background: #FFF7ED;
    border: 1px solid #FED7AA;
    border-left: 4px solid #F97316;
    border-radius: 0 6px 6px 0;
    padding: 12px 16px;
    font-size: 13px;
    color: #9a3412;
  }
  .deposit-box strong { font-weight: 700; }

  /* ── Footer ── */
  .footer {
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #6b7280;
    line-height: 1.7;
  }
  .validity-note {
    font-weight: 600;
    color: #374151;
    margin-bottom: 4px;
  }
</style>
</head>
<body>
<div class="page">

  <!-- ── HEADER ── -->
  <div class="header">
    <div>
      <div class="business-name">${escHtml(d.businessName)}</div>
      <div class="trader-contact">${escHtml(d.traderLocation)}</div>
      ${contactLine}
    </div>
    <div class="quote-meta">
      <div class="quote-label">QUOTE</div>
      <div class="quote-number">${escHtml(qNum)}</div>
      <div class="meta-row">Date: ${escHtml(quoteDate)}</div>
      <div class="meta-row">Expires: ${escHtml(expiryDate)}</div>
    </div>
  </div>

  <!-- ── CUSTOMER / JOB ── -->
  <div class="customer-section">
    <div class="customer-label">Quote prepared for</div>
    <div class="customer-name">${escHtml(d.customerName || 'Customer')}</div>
    ${jobDescription}
  </div>

  <!-- ── LINE ITEMS ── -->
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit Price</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <!-- ── TOTALS ── -->
  <div class="summary-section">
    <table>
      <tbody>
        <tr class="summary-row">
          <td colspan="3">Subtotal${d.vatRegistered ? ' (ex VAT)' : ''}</td>
          <td class="num">${formatGBP(d.subtotal)}</td>
        </tr>
        ${vatRow}
        <tr class="total-row">
          <td colspan="3">TOTAL</td>
          <td class="num">${formatGBP(d.total)}</td>
        </tr>
        ${depositRow}
      </tbody>
    </table>
  </div>

  <!-- ── DEPOSIT CALLOUT (only when a deposit is required) ── -->
  ${
    d.depositAmount > 0
      ? `<div class="deposit-box">
           <strong>Deposit required to confirm booking:</strong>
           ${formatGBP(d.depositAmount)} (${d.depositPercent}% of total)
         </div>`
      : ''
  }

  <!-- ── FOOTER ── -->
  <div class="footer">
    <div class="validity-note">This quote is valid for 30 days from ${escHtml(quoteDate)}.</div>
    <div>All work carried out to BS 7671:2018 standards.</div>
    <div style="margin-top:6px">${registrationNote}</div>
  </div>

</div>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateQuotePdf(data: PdfQuoteData): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    // In production (container) PUPPETEER_EXECUTABLE_PATH points to system Chromium.
    // In local dev it is unset and Puppeteer uses its own bundled Chrome.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(data), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
