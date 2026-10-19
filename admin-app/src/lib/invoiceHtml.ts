import { dateLabel, rupees } from "./format";

export interface InvoiceView {
  id: string;
  number: string | null;
  kind: "TAX_INVOICE" | "PROFORMA";
  status: string;
  storedStatus: string;
  customer: { id: string; name: string; gstin: string | null; address: string | null; stateCode: string | null };
  periodStart: string;
  periodEnd: string;
  issueDate: string | null;
  dueDate: string | null;
  taxRule: { id: string; name: string; sacCode: string | null; verified: boolean } | null;
  taxSplit: "INTRA_STATE" | "INTER_STATE" | "NONE";
  rates: { cgst: string | null; sgst: string | null; igst: string | null };
  lines: { id: string; kind: string; approvedWorkId: string | null; description: string; quantity: string | null; unitRate: string | null; amount: string; rateSource: string | null }[];
  totals: { subtotal: string; discountTotal: string; taxableValue: string; cgst: string; sgst: string; igst: string; taxTotal: string; total: string; amountPaid: string; balance: string; hours: string };
  payments: { paymentId: string; amount: string; receivedOn: string; mode: string; reference: string | null }[];
  issueBlockers: string[];
  taxVerified: boolean;
  seller: { legalName?: string | null; tradeName?: string | null; gstin?: string | null; address?: string | null; phone?: string | null; email?: string | null; bankDetails?: string | null; invoiceTerms?: string | null } | null;
  notes: string | null;
  cancelReason: string | null;
}

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Printable invoice. Drafts and unverified tax are watermarked so they cannot be mistaken for a final tax invoice. */
export function invoiceHtml(inv: InvoiceView): string {
  const draft = inv.storedStatus === "DRAFT";
  const title = inv.kind === "PROFORMA" ? "PROFORMA INVOICE" : "TAX INVOICE";
  const watermark = draft ? "DRAFT – NOT A VALID INVOICE" : inv.storedStatus === "CANCELLED" ? "CANCELLED" : inv.kind === "TAX_INVOICE" && !inv.taxVerified ? "TAX NOT VERIFIED" : "";
  const s = inv.seller ?? {};
  const rows = inv.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="r">${l.quantity ? `${l.quantity} h` : ""}</td><td class="r">${l.unitRate ? rupees(l.unitRate, { paise: true }) : ""}</td><td class="r">${l.kind === "DISCOUNT" ? "−" : ""}${rupees(l.amount, { paise: true })}</td></tr>`,
    )
    .join("");
  const tax =
    inv.taxSplit === "INTRA_STATE"
      ? `<tr><td>CGST @ ${inv.rates.cgst}%</td><td class="r">${rupees(inv.totals.cgst, { paise: true })}</td></tr><tr><td>SGST @ ${inv.rates.sgst}%</td><td class="r">${rupees(inv.totals.sgst, { paise: true })}</td></tr>`
      : inv.taxSplit === "INTER_STATE"
        ? `<tr><td>IGST @ ${inv.rates.igst}%</td><td class="r">${rupees(inv.totals.igst, { paise: true })}</td></tr>`
        : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(inv.number ?? "Draft invoice")}</title>
<style>
body{font-family:Inter,Arial,sans-serif;color:#0F172A;margin:32px;font-size:12px}
h1{font-size:20px;margin:0;color:#142B45}.muted{color:#64748B}.r{text-align:right}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:6px 8px;border-bottom:1px solid #E2E8F0;vertical-align:top}
th{background:#142B45;color:#fff;text-align:left;font-size:11px}.totals td{border:none}.totals tr:last-child td{font-weight:800;font-size:14px;border-top:2px solid #142B45}
.head{display:flex;justify-content:space-between;gap:24px}.box{border:1px solid #E2E8F0;border-radius:6px;padding:10px;flex:1}
.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:56px;font-weight:800;color:rgba(239,68,68,.15);transform:rotate(-20deg)}
.bar{height:4px;background:#F28C28;margin:12px 0}
</style></head><body>
${watermark ? `<div class="wm">${watermark}</div>` : ""}
<div class="head"><div><h1>${esc(s.legalName || s.tradeName || "AJ Earth Movers")}</h1><div class="muted">${esc(s.address)}</div>${s.gstin ? `<div>GSTIN: ${esc(s.gstin)}</div>` : ""}${s.phone ? `<div>${esc(s.phone)} ${esc(s.email)}</div>` : ""}</div>
<div class="r"><h1>${title}</h1><div>No: <b>${esc(inv.number ?? "—")}</b></div><div>Date: ${inv.issueDate ? dateLabel(inv.issueDate) : "—"}</div><div>Due: ${inv.dueDate ? dateLabel(inv.dueDate) : "—"}</div></div></div>
<div class="bar"></div>
<div class="head"><div class="box"><div class="muted">Bill to</div><b>${esc(inv.customer.name)}</b><div>${esc(inv.customer.address)}</div>${inv.customer.gstin ? `<div>GSTIN: ${esc(inv.customer.gstin)}</div>` : ""}</div>
<div class="box"><div class="muted">Billing period</div><b>${dateLabel(inv.periodStart)} – ${dateLabel(inv.periodEnd)}</b><div>Approved operating hours: ${inv.totals.hours} h</div>${inv.taxRule?.sacCode ? `<div>SAC: ${esc(inv.taxRule.sacCode)}</div>` : ""}</div></div>
<table><thead><tr><th>#</th><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="width:50%;margin-left:auto"><tbody>
<tr><td>Subtotal</td><td class="r">${rupees(inv.totals.subtotal, { paise: true })}</td></tr>
${Number(inv.totals.discountTotal) > 0 ? `<tr><td>Discounts</td><td class="r">−${rupees(inv.totals.discountTotal, { paise: true })}</td></tr>` : ""}
<tr><td>Taxable value</td><td class="r">${rupees(inv.totals.taxableValue, { paise: true })}</td></tr>${tax}
<tr><td>Invoice total</td><td class="r">${rupees(inv.totals.total, { paise: true })}</td></tr></tbody></table>
${Number(inv.totals.amountPaid) > 0 ? `<p>Paid: ${rupees(inv.totals.amountPaid, { paise: true })} · Balance due: <b>${rupees(inv.totals.balance, { paise: true })}</b></p>` : ""}
${s.bankDetails ? `<p class="muted">Bank details: ${esc(s.bankDetails)}</p>` : ""}
${s.invoiceTerms ? `<p class="muted">Terms: ${esc(s.invoiceTerms)}</p>` : ""}
${inv.notes ? `<p class="muted">${esc(inv.notes)}</p>` : ""}
<p class="muted">Billed hours are approved operating hours from verified meter readings.</p>
</body></html>`;
}
