import puppeteer from 'puppeteer';
import type { Quote } from '@quotebot/shared';
import { formatGBP, formatDate } from '@quotebot/shared';

export async function generateQuotePdf(
  quote: Quote,
  trader: {
    businessName: string;
    fullName: string;
    email: string;
    phone: string;
    addressLine1: string;
    city: string;
    postcode: string;
    vatNumber?: string;
    logoUrl?: string;
    quoteFooterText?: string;
  }
): Promise<Buffer> {
  const html = buildQuoteHtml(quote, trader);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function buildQuoteHtml(quote: Quote, trader: {
  businessName: string; fullName: string; email: string; phone: string;
  addressLine1: string; city: string; postcode: string; vatNumber?: string;
  logoUrl?: string; quoteFooterText?: string;
}): string {
  const lineItemsHtml = quote.lineItems
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (item) => `
      <tr>
        <td class="desc">${escHtml(item.description)}</td>
        <td class="qty">${item.quantity} ${escHtml(item.unit)}</td>
        <td class="amount">${formatGBP(item.lineNetPence)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Arial, sans-serif; font-size: 13px; color: #1a1a1a; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .business-name { font-size: 22px; font-weight: 700; color: #1d4ed8; }
  .meta { text-align: right; }
  .quote-title { font-size: 28px; font-weight: 800; color: #111; margin-bottom: 8px; }
  .badge { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .parties { display: flex; gap: 40px; margin-bottom: 28px; }
  .party h4 { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 6px; }
  .party p { line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead tr { background: #1d4ed8; color: white; }
  th { padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  tr:last-child td { border-bottom: none; }
  .qty { text-align: center; width: 100px; }
  .amount { text-align: right; width: 100px; font-weight: 500; }
  .totals { margin-left: auto; width: 260px; }
  .totals table { margin-bottom: 0; }
  .totals td { border: none; padding: 5px 8px; }
  .totals .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #1d4ed8; padding-top: 10px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
  .validity { background: #fef3c7; border: 1px solid #fcd34d; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <div>
    ${trader.logoUrl ? `<img src="${escHtml(trader.logoUrl)}" height="60" alt="logo" style="margin-bottom:8px;display:block">` : ''}
    <div class="business-name">${escHtml(trader.businessName)}</div>
    <div style="color:#6b7280;margin-top:4px;line-height:1.6">
      ${escHtml(trader.addressLine1)}<br>
      ${escHtml(trader.city)}, ${escHtml(trader.postcode)}<br>
      ${escHtml(trader.phone)}<br>
      ${escHtml(trader.email)}
      ${trader.vatNumber ? `<br>VAT: ${escHtml(trader.vatNumber)}` : ''}
    </div>
  </div>
  <div class="meta">
    <div class="quote-title">QUOTE</div>
    <div style="font-weight:600;font-size:15px;margin-bottom:6px">${escHtml(quote.quoteNumber)}</div>
    <div class="badge">${escHtml(quote.status.toUpperCase())}</div>
    <div style="margin-top:8px;color:#6b7280">Date: ${formatDate(new Date(quote.createdAt))}</div>
    ${quote.validUntil ? `<div style="color:#6b7280">Valid until: ${formatDate(new Date(quote.validUntil))}</div>` : ''}
  </div>
</div>

${quote.validUntil ? `<div class="validity">⚠️ This quote is valid until <strong>${formatDate(new Date(quote.validUntil))}</strong>.</div>` : ''}

<div class="parties">
  <div class="party">
    <h4>Quote For</h4>
    <p><strong>${escHtml(quote.customer?.name ?? 'Customer')}</strong>
    ${quote.customer?.email ? `<br>${escHtml(quote.customer.email)}` : ''}
    ${quote.customer?.phone ? `<br>${escHtml(quote.customer.phone)}` : ''}
    ${quote.jobAddress ? `<br>${escHtml(quote.jobAddress)}` : ''}
    </p>
  </div>
  <div class="party">
    <h4>Job Type</h4>
    <p>${escHtml(quote.jobType.replace(/_/g, ' '))}</p>
  </div>
</div>

<p style="margin-bottom:16px;color:#374151">${escHtml(quote.jobDescription)}</p>

<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="qty" style="text-align:center">Qty / Unit</th>
      <th class="amount" style="text-align:right">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${lineItemsHtml}
  </tbody>
</table>

<div class="totals">
  <table>
    <tr>
      <td>Subtotal (ex VAT)</td>
      <td class="amount">${formatGBP(quote.subtotalNetPence)}</td>
    </tr>
    <tr>
      <td>VAT (${quote.vatPct}%)</td>
      <td class="amount">${formatGBP(quote.vatAmountPence)}</td>
    </tr>
    <tr class="total-row">
      <td>Total</td>
      <td class="amount">${formatGBP(quote.totalGrossPence)}</td>
    </tr>
  </table>
</div>

<div class="footer">
  ${trader.quoteFooterText ? `<p style="margin-bottom:8px">${escHtml(trader.quoteFooterText)}</p>` : ''}
  <p>Generated by QuoteBot · ${escHtml(trader.businessName)} · ${escHtml(trader.fullName)}</p>
</div>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
