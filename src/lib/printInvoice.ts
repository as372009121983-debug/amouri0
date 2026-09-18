/* ═══════════════════════════════════════════════════════════════════
   Print Invoice — Mobile-First Responsive Receipt System
   Width: 100% (fills phone screen)  |  Height: auto
   Font: Cairo  |  Pure black/white  |  RTL layout
═══════════════════════════════════════════════════════════════════ */

/* ── Logo helper ────────────────────────────────────────────────── */
const getLogoURL = (): string =>
  typeof window !== 'undefined' ? window.location.origin + '/logo.png' : '/logo.png';

export interface PrintItem {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  purchase_price?: number;
}

export interface PrintOptions {
  type: 'sale' | 'purchase' | 'return';
  invoiceDate: string;
  invoiceNumber?: string;
  status: string;
  warehouseName?: string;
  partyLabel?: string;
  partyName: string;
  partyPhone?: string;
  partyLocation?: string;
  items: PrintItem[];
  totalAmount: number;
  paidAmount: number;
  discount?: number;
  notes?: string;
  previousBalance?: number;
  showProfit?: boolean;
}

/* ── Company info ─────────────────────────────────────────────── */
const loadCompanyInfo = () => {
  try { const s = localStorage.getItem('wms_company_info'); return s ? JSON.parse(s) : null; }
  catch { return null; }
};

const defaultInfo = {
  name: 'العموري', subname: 'لقطع غيار السيارات بالدلنجات',
  brand: 'العموري', phone: '01000000000', address: 'القاهرة، مصر',
  thanks: 'شكرًا لثقتكم', footer: 'الاستبدال والاسترجاع خلال 14 يوم من تاريخ الاستلام.',
};

export const getCompanyInfo = () => ({ ...defaultInfo, ...(loadCompanyInfo() || {}) });
export const COMPANY_INFO = new Proxy(defaultInfo, {
  get(_, key: string) { return getCompanyInfo()[key as keyof typeof defaultInfo]; },
});

const fmtEGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const fmt    = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 });

/* ═══════════════════════════════════════════════════════════════════
   MOBILE-FIRST RECEIPT CSS
═══════════════════════════════════════════════════════════════════ */
const THERMAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Cairo:wght@400;600;700;900&display=swap');

*{margin:0;padding:0;box-sizing:border-box}

html,body{
  background:#ffffff!important;
  color:#000000!important;
  font-family:'Noto Sans Arabic','IBM Plex Sans Arabic','Cairo',Arial,sans-serif;
  font-size:14px;
  line-height:1.6;
  direction:rtl;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  -webkit-text-size-adjust:100%;
  color-scheme:light only;
}

.receipt{
  width:100%;
  max-width:100%;
  background:#ffffff;
  color:#000000;
  padding:10px;
  overflow-x:visible;
}

/* ─── Scroll wrapper for wide tables ─── */
.tbl-scroll{
  width:100%;
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
}

.r-header{
  text-align:center;
  padding-bottom:10px;
}
.r-logo-wrap{
  display:flex;
  justify-content:center;
  margin-bottom:8px;
}
.r-logo{
  width:60px;
  height:60px;
  object-fit:contain;
}
.r-company{
  font-size:20px;
  font-weight:900;
  color:#000000;
  line-height:1.2;
}
.r-subname{
  font-size:14px;
  color:#222;
  margin-top:2px;
  font-weight:600;
}
.r-contact{
  font-size:13px;
  color:#333;
  margin-top:4px;
}
.r-inv-num{
  font-size:15px;
  font-weight:900;
  color:#000000;
  margin-top:6px;
}
.r-meta{
  font-size:13px;
  color:#333;
  margin-top:3px;
}

.r-dash{
  border:none;
  border-top:1.5px dashed #000000;
  margin:10px 0;
}

.r-section{
  font-size:12px;
  font-weight:700;
  text-align:center;
  letter-spacing:1px;
  color:#000000;
  padding:0 0 5px;
  text-transform:uppercase;
}

.r-party{
  padding:4px 0 8px;
  font-size:14px;
  color:#000000;
}
.r-party-row{
  display:flex;
  align-items:flex-start;
  gap:6px;
  margin-bottom:4px;
  line-height:1.5;
}
.r-party-lbl{
  font-weight:700;
  flex-shrink:0;
  min-width:56px;
  color:#000000;
}
.r-party-val{
  color:#000000;
  flex:1;
  word-break:break-word;
}

.r-items-table{
  width:100%;
  border-collapse:collapse;
  table-layout:fixed;
  margin:4px 0 6px;
  border:1.5px solid #000;
}
.r-items-table colgroup col.col-name  { width:auto }
.r-items-table colgroup col.col-qty   { width:52px }
.r-items-table colgroup col.col-price { width:72px }
.r-items-table colgroup col.col-total { width:78px }

.r-items-table thead tr{
  background:#1a1a1a;
  color:#ffffff;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.r-items-table thead th{
  padding:9px 8px;
  font-size:13px;
  font-weight:700;
  color:#ffffff;
  text-align:right;
  white-space:nowrap;
  border:1px solid #333;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.r-items-table thead th.col-qty,
.r-items-table thead th.col-price,
.r-items-table thead th.col-total{
  text-align:center;
}
.r-items-table tbody tr{
  border-bottom:1px solid #ddd;
}
.r-items-table tbody tr:nth-child(even){
  background:#f8fafb;
}
.r-items-table tbody tr:last-child{
  border-bottom:1px solid #bbb;
}
.r-items-table tbody td{
  padding:7px 6px;
  font-size:12px;
  color:#000000;
  vertical-align:middle;
  text-align:right;
  white-space:nowrap !important;
  overflow:hidden;
  text-overflow:ellipsis;
  max-width:160px;
  border:1px solid #e0e0e0;
}
.r-items-table tbody td.td-name{
  font-weight:700;
  font-size:12px;
  line-height:1.3;
  border-right:3px solid #1a1a1a;
  max-width:150px;
}
.r-items-table tbody td.td-qty{
  font-size:12px;
  font-weight:600;
  text-align:center;
  color:#000000;
  white-space:nowrap;
  background:#f0f9ff;
}
.r-items-table tbody td.td-price{
  font-size:12px;
  text-align:center;
  color:#444;
  white-space:nowrap;
}
.r-items-table tbody td.td-total{
  font-size:13px;
  font-weight:900;
  color:#000000;
  text-align:center;
  white-space:nowrap;
  background:#f0fdf4;
}
.r-item-profit{
  font-size:11px;
  font-weight:700;
  margin-top:2px;
  display:block;
}

.r-totals{
  width:100%;
  margin:6px 0 4px;
  border:1.5px solid #e0e0e0;
  border-radius:8px;
  overflow:hidden;
}
.r-total-row{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:9px 12px;
  font-size:14px;
  color:#000000;
  border-bottom:1px solid #e8e8e8;
  background:#ffffff;
}
.r-total-row:last-child{
  border-bottom:none;
}
.r-total-lbl{
  font-weight:700;
  color:#000000;
  font-size:14px;
}
.r-total-val{
  font-weight:700;
  color:#000000;
  font-size:14px;
  text-align:left;
}

.r-total-grand{
  background:#000000!important;
  border-radius:6px;
  margin:8px 0 4px;
  border:none!important;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
.r-total-grand .r-total-lbl{
  font-size:17px;
  font-weight:900;
  color:#ffffff;
}
.r-total-grand .r-total-val{
  font-size:17px;
  font-weight:900;
  color:#ffffff;
}

.r-paid .r-total-lbl{ color:#000000 }
.r-paid .r-total-val{
  color:#006600;
  font-size:16px;
  font-weight:900;
}

.r-remaining{
  background:#fff5f5;
  border-radius:6px;
  margin-top:4px;
}
.r-remaining .r-total-lbl,
.r-remaining .r-total-val{
  color:#cc0000;
  font-size:16px;
  font-weight:900;
}

.r-settled{
  text-align:center;
  font-size:16px;
  font-weight:900;
  color:#006600;
  background:#f0fdf4;
  border-radius:6px;
  padding:10px 0;
  margin-top:4px;
  border:2px solid #bbf7d0;
}

.r-thanks{
  text-align:center;
  padding:10px 0 4px;
  background:linear-gradient(135deg,#f8f9fa,#fff);
  border-radius:8px;
  border:1.5px dashed #ccc;
  margin:6px 0;
  padding:14px;
}
.r-thanks-main{
  font-size:18px;
  font-weight:900;
  color:#000000;
  letter-spacing:0.5px;
}
.r-thanks-sub{
  font-size:13px;
  color:#444;
  margin-top:5px;
  line-height:1.8;
  border-top:1px dashed #ddd;
  padding-top:6px;
  margin-top:8px;
}
.r-thanks-date{
  font-size:12px;
  color:#666;
  margin-top:6px;
}

.r-back-btn{
  display:flex;
  justify-content:center;
  padding:18px 0 12px;
}
.r-back-btn button{
  background:linear-gradient(135deg,#1a1a1a,#333);
  color:#ffffff;
  border:none;
  border-radius:12px;
  padding:14px 0;
  font-size:16px;
  font-family:'Noto Sans Arabic','IBM Plex Sans Arabic','Cairo',Arial,sans-serif;
  font-weight:700;
  cursor:pointer;
  width:100%;
  max-width:320px;
  min-height:52px;
  box-shadow:0 4px 12px rgba(0,0,0,.25);
  letter-spacing:0.5px;
}
.r-back-btn button:hover{ background:linear-gradient(135deg,#333,#555) }
.r-back-btn button:active{ background:#111 }

@media print{
  @page{
    margin:8mm 6mm;
    size:A4 portrait;
  }
  html,body{
    width:100%;
    padding:0;
    margin:0;
    font-size:12px;
  }
  .receipt{
    width:100%;
    padding:0;
    box-shadow:none!important;
    overflow:visible!important;
  }
  .tbl-scroll{
    overflow:visible!important;
  }
  .r-back-btn{ display:none!important }
  .r-items-table thead tr,
  .r-total-grand{
    -webkit-print-color-adjust:exact!important;
    print-color-adjust:exact!important;
  }
  .r-thanks{
    border:1px dashed #999!important;
    background:#fff!important;
  }
}

@media screen{
  body{
    background:#e5e7eb;
    min-height:100vh;
    padding:20px 0 56px;
  }
  .receipt{
    max-width:520px;
    margin:0 auto;
    box-shadow:0 8px 32px rgba(0,0,0,.18);
    border-radius:12px;
    background:#ffffff;
    padding:20px;
    overflow-x:visible;
    border:1px solid #d1d5db;
  }
  .tbl-scroll{
    overflow-x:auto !important;
    -webkit-overflow-scrolling:touch;
  }
}
`;

/* ═══════════════════════════════════════════════════════════════════
   BUILD MOBILE-FIRST RECEIPT HTML
═══════════════════════════════════════════════════════════════════ */
const buildThermalHTML = (opts: PrintOptions): string => {
  const ci      = getCompanyInfo();
  const logo    = getLogoURL();
  const isSale  = opts.type === 'sale';
  const isPurch = opts.type === 'purchase';
  const invNum  = opts.invoiceNumber || Math.random().toString(36).slice(-8).toUpperCase();
  const remaining = opts.totalAmount - opts.paidAmount;
  const prevBal   = opts.previousBalance || 0;
  const typeLabel = isSale ? 'فاتورة بيع' : isPurch ? 'أمر شراء' : 'إيصال مرتجع';
  const partyLbl  = isSale ? 'العميل' : isPurch ? 'المورد' : (opts.partyLabel || 'الطرف');

  const now     = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit' });

  const totalCost = opts.showProfit
    ? opts.items.reduce((s, it) => s + (it.purchase_price || 0) * it.quantity, 0) : 0;

  const itemRowsHTML = opts.items.length
    ? opts.items.map(it => {
        const rowProfit = opts.showProfit && it.purchase_price != null
          ? (it.unit_price - it.purchase_price) * it.quantity : null;
        const profitSpan = rowProfit !== null
          ? `<span class="r-item-profit" style="color:${rowProfit >= 0 ? '#006600' : '#cc0000'}">ربح: ${fmt(rowProfit)} ج.م</span>`
          : '';
        const unitLabel = it.unit ? ` ${it.unit}` : '';
        return `
<tr>
  <td class="td-name">${it.name || '—'}${profitSpan}</td>
  <td class="td-qty">${it.quantity.toLocaleString('ar-EG')}${unitLabel}</td>
  <td class="td-price">${fmt(it.unit_price)}</td>
  <td class="td-total">${fmt(it.total_price)}</td>
</tr>`;
      }).join('')
    : `<tr><td colspan="4" style="text-align:center;padding:14px;color:#888;font-size:13px">لا توجد أصناف</td></tr>`;

  const discountLine = (opts.discount && opts.discount > 0)
    ? `<div class="r-total-row">
         <span class="r-total-lbl">خصم:</span>
         <span class="r-total-val" style="color:#cc0000">- ${fmtEGP(opts.discount)}</span>
       </div>` : '';

  const profitSummary = opts.showProfit && totalCost > 0
    ? `<div class="r-total-row">
         <span class="r-total-lbl">إجمالي الربح:</span>
         <span class="r-total-val" style="color:#006600">${fmtEGP(opts.totalAmount - totalCost)}</span>
       </div>` : '';

  const prevBalLine = prevBal > 0
    ? `<div class="r-total-row">
         <span class="r-total-lbl">رصيد سابق:</span>
         <span class="r-total-val">${fmtEGP(prevBal)}</span>
       </div>` : '';

  const settledOrRemaining = remaining > 0
    ? `<div class="r-total-row r-remaining">
         <span class="r-total-lbl">المتبقي${isSale ? ' للعميل' : ' للمورد'}:</span>
         <span class="r-total-val">${fmtEGP(remaining + prevBal)}</span>
       </div>`
    : `<div class="r-settled">✓ مسدَّد بالكامل</div>`;

  const warehouseLine = opts.warehouseName
    ? `<div class="r-party-row"><span class="r-party-lbl">المخزن:</span><span class="r-party-val">${opts.warehouseName}</span></div>` : '';
  const phoneLine = opts.partyPhone
    ? `<div class="r-party-row"><span class="r-party-lbl">الهاتف:</span><span class="r-party-val">${opts.partyPhone}</span></div>` : '';
  const locLine = opts.partyLocation
    ? `<div class="r-party-row"><span class="r-party-lbl">العنوان:</span><span class="r-party-val">${opts.partyLocation}</span></div>` : '';
  const notesSection = opts.notes
    ? `<hr class="r-dash"/>
       <div class="r-section">ملاحظات</div>
       <div style="font-size:13px;color:#333;line-height:1.7;padding:4px 0 8px">${opts.notes}</div>` : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <meta name="color-scheme" content="light only"/>
  <title>${typeLabel} # ${invNum}</title>
  <style>${THERMAL_CSS}</style>
</head>
<body>
<div class="receipt">

  <!-- ══ COMPANY HEADER ══ -->
  <div style="background:linear-gradient(135deg,#a97a1f,#4d350d);border-radius:10px;padding:16px;margin-bottom:12px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="display:flex;justify-content:center;margin-bottom:8px">
      <img src="${logo}" alt="${ci.name}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;border:2px solid rgba(255,255,255,.3)" onerror="this.style.display='none'"/>
    </div>
    <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.5px">${ci.name}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:3px">${ci.subname}</div>
    <div style="font-size:12px;color:#ffffff;font-weight:700;margin-top:4px;text-decoration:none">☏ <span style="color:#ffffff;text-decoration:none">${ci.phone}</span> — ${ci.address}</div>
  </div>

  <!-- ══ INVOICE META ══ -->
  <div style="display:flex;justify-content:space-between;align-items:stretch;gap:8px;margin-bottom:10px">
    <div style="flex:1;background:#f8f9fa;border:1.5px solid #e0e0e0;border-radius:8px;padding:10px 12px;border-right:4px solid #8a6118">
      <div style="font-size:11px;color:#666;font-weight:600;margin-bottom:3px">نوع المستند</div>
      <div style="font-size:15px;font-weight:900;color:#8a6118">${typeLabel}</div>
      <div style="font-size:12px;color:#444;margin-top:4px;font-weight:700"># ${invNum}</div>
    </div>
    <div style="flex:1;background:#f8f9fa;border:1.5px solid #e0e0e0;border-radius:8px;padding:10px 12px;text-align:left">
      <div style="font-size:11px;color:#666;font-weight:600;margin-bottom:3px">التاريخ</div>
      <div style="font-size:13px;font-weight:700;color:#000">${opts.invoiceDate}</div>
      <div style="font-size:11px;color:#555;margin-top:2px">${timeStr}</div>
      <div style="margin-top:5px;display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${opts.status === 'مكتملة' ? '#dcfce7' : '#fef9c3'};color:${opts.status === 'مكتملة' ? '#15803d' : '#854d0e'}">${opts.status}</div>
    </div>
  </div>

  <!-- ══ PARTY INFO ══ -->
  <div style="background:#fdf8ec;border:1.5px solid #e9c66d;border-radius:8px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:11px;color:#8a6118;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">── ${partyLbl} ──</div>
    <div style="font-size:16px;font-weight:900;color:#000;margin-bottom:4px">${opts.partyName || '—'}</div>
    ${opts.partyPhone ? `<div style="font-size:12px;color:#000000;margin-top:2px;font-weight:600">☏ ${opts.partyPhone}</div>` : ''}
    ${opts.partyLocation ? `<div style="font-size:12px;color:#444;margin-top:2px">📍 ${opts.partyLocation}</div>` : ''}
    ${opts.warehouseName ? `<div style="font-size:12px;color:#8a6118;margin-top:2px;font-weight:600">🏪 ${opts.warehouseName}</div>` : ''}
  </div>

  <!-- ══ ITEMS TABLE ══ -->
  <div style="font-size:11px;color:#8a6118;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">── الأصناف (${opts.items.length}) ──</div>
  <table class="r-items-table">
    <colgroup>
      <col class="col-name"/>
      <col class="col-qty"/>
      <col class="col-price"/>
      <col class="col-total"/>
    </colgroup>
    <thead>
      <tr>
        <th>اسم الصنف</th>
        <th class="col-qty">الكمية</th>
        <th class="col-price">السعر</th>
        <th class="col-total">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${itemRowsHTML}
    </tbody>
  </table>

  <!-- ══ TOTALS ══ -->
  <div style="margin:8px 0 6px">
    ${discountLine}
    <div class="r-total-row r-total-grand">
      <span class="r-total-lbl">▶ الإجمالي الكلي:</span>
      <span class="r-total-val">${fmtEGP(opts.totalAmount)}</span>
    </div>
    <div class="r-total-row r-paid">
      <span class="r-total-lbl">✓ المدفوع:</span>
      <span class="r-total-val">${fmtEGP(opts.paidAmount)}</span>
    </div>
    ${prevBalLine}
    ${settledOrRemaining}
    ${profitSummary}
  </div>

  ${notesSection}

  <div class="r-thanks">
    <div class="r-thanks-main">🌟 ${ci.thanks}</div>
    <div class="r-thanks-sub">${ci.footer}</div>
    <div class="r-thanks-date">فاتورة # ${invNum} | ${opts.invoiceDate}</div>
  </div>

  <div class="r-back-btn">
    <button onclick="if(window.opener||window.history.length<=1){window.close()}else{window.history.back()}">← رجوع / إغلاق</button>
  </div>

</div>
</body>
</html>`;
};

/* ── Public helpers ───────────────────────────────────────────── */
export const printInvoice = (opts: PrintOptions): void => {
  const html = buildThermalHTML(opts);
  const win  = window.open('', '_blank');
  if (!win) {
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
      if (!a) alert('يرجى السماح بالنوافذ المنبثقة في المتصفح ثم المحاولة مجدداً.');
    } catch { alert('تعذّر فتح صفحة الطباعة. يرجى السماح بالنوافذ المنبثقة.'); }
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
};

export const saveInvoiceAsPDF  = printInvoice;
export const buildInvoiceHTMLString = (opts: PrintOptions): string => buildThermalHTML(opts);

/* ═══════════════════════════════════════════════════════════════════
   UNIFIED REPORT PRINT
═══════════════════════════════════════════════════════════════════ */
export interface UnifiedReportColumn {
  label: string;
  key: string;
  align?: 'right' | 'center' | 'left';
  color?: (val: any, row: any) => string | undefined;
  format?: (val: any, row: any) => string;
}

export interface UnifiedReportKPI {
  label: string;
  value: string;
  color?: string;
}

export interface UnifiedReportOptions {
  title: string;
  subtitle?: string;
  dateRange?: string;
  kpis?: UnifiedReportKPI[];
  columns: UnifiedReportColumn[];
  rows: Record<string, any>[];
  footerCells?: Record<string, string>;
  notes?: string;
}

export const buildUnifiedReportHTML = (opts: UnifiedReportOptions): string => {
  const ci   = getCompanyInfo();
  const logo = getLogoURL();
  const now  = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  const kpisHTML = opts.kpis && opts.kpis.length > 0
    ? `<div class="r-report-kpis">${opts.kpis.map(k => `
        <div class="r-report-kpi">
          <div class="r-report-kv" style="${k.color ? `color:${k.color}` : ''}">${k.value}</div>
          <div class="r-report-kl">${k.label}</div>
        </div>`).join('')}</div>`
    : '';

  const theadHTML = `<thead><tr>${opts.columns.map(c =>
    `<th style="text-align:${c.align || 'right'}">${c.label}</th>`).join('')}</tr></thead>`;

  const tbodyHTML = opts.rows.length > 0
    ? opts.rows.map((row, idx) => `<tr class="${idx % 2 === 1 ? 'r-report-alt' : ''}">${opts.columns.map(c => {
        const raw = row[c.key];
        const val = c.format ? c.format(raw, row) : (raw ?? '—');
        const color = c.color ? c.color(raw, row) : undefined;
        return `<td style="text-align:${c.align||'right'}${color ? `;color:${color};font-weight:700` : ''}">${val}</td>`;
      }).join('')}</tr>`).join('')
    : `<tr><td colspan="${opts.columns.length}" style="text-align:center;padding:20px;color:#999">لا توجد بيانات</td></tr>`;

  const tfootHTML = opts.footerCells
    ? `<tfoot><tr>${opts.columns.map(c => {
        const v = opts.footerCells![c.key];
        return `<td style="text-align:${c.align||'right'};font-weight:900;color:#fff">${v || ''}</td>`;
      }).join('')}</tr></tfoot>`
    : '';

  const notesSection = opts.notes
    ? `<hr class="r-dash"/><div class="r-section">ملاحظات</div><div style="font-size:13px;color:#333;line-height:1.7;padding:4px 0 8px">${opts.notes}</div>`
    : '';

  const extraCSS = `
  .r-report-kpis {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin:10px 0;
  }
  .r-report-kpi {
    flex:1;
    min-width:100px;
    background:#fff;
    border:1.5px solid #e2e8f0;
    border-radius:10px;
    padding:10px 14px;
    border-top:3px solid #8a6118;
  }
  .r-report-kv {
    font-size:16px;
    font-weight:900;
    color:#1e293b;
  }
  .r-report-kl {
    font-size:11px;
    color:#64748b;
    margin-top:3px;
  }
  .r-report-tbl {
    width:100%;
    border-collapse:collapse;
    font-size:13px;
    direction:rtl;
    table-layout:auto;
    border:1.5px solid #000;
  }
  .r-report-tbl thead tr {
    background:linear-gradient(135deg,#a97a1f,#4d350d);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .r-report-tbl thead th {
    padding:5px 5px;
    font-size:10px;
    font-weight:700;
    color:#fff;
    white-space:nowrap;
    border:1px solid rgba(255,255,255,.2);
  }
  .r-report-tbl tbody tr {
    border-bottom:1px solid #ddd;
  }
  .r-report-tbl tbody tr:nth-child(even) td {
    background:#f8fafb;
  }
  .r-report-tbl tbody tr:last-child {
    border-bottom:1px solid #bbb;
  }
  .r-report-tbl tbody td {
    padding:5px 5px;
    font-size:10px;
    color:#000;
    vertical-align:middle;
    white-space:nowrap !important;
    overflow:hidden;
    text-overflow:ellipsis;
    max-width:140px;
    border:1px solid #e8e8e8;
  }
  .r-report-tbl tfoot tr {
    background:linear-gradient(135deg,#a97a1f,#4d350d);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .r-report-tbl tfoot td {
    padding:5px 5px;
    font-size:10px;
    font-weight:900;
    color:#fff;
    white-space:nowrap;
    border:1px solid rgba(255,255,255,.2);
  }
  @media print {
    @page { size:A4 portrait; margin:10mm 8mm; }
    .r-report-tbl thead tr,
    .r-report-tbl tfoot tr {
      -webkit-print-color-adjust:exact!important;
      print-color-adjust:exact!important;
    }
  }
  @media screen {
    .receipt { max-width:820px; overflow-x:visible; }
    .tbl-scroll { overflow-x:auto!important; -webkit-overflow-scrolling:touch; }
  }
  `;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <meta name="color-scheme" content="light only"/>
  <title>${opts.title}</title>
  <style>${THERMAL_CSS}${extraCSS}</style>
</head>
<body>
<div class="receipt">

  <!-- ══ REPORT HEADER ══ -->
  <div style="background:linear-gradient(135deg,#a97a1f,#4d350d);border-radius:10px;padding:16px;margin-bottom:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="${logo}" alt="${ci.name}" style="width:48px;height:48px;object-fit:contain;border-radius:6px;border:2px solid rgba(255,255,255,.3)" onerror="this.style.display='none'"/>
        <div>
          <div style="font-size:18px;font-weight:900;color:#fff">${ci.name}</div>
          <div style="font-size:11px;color:#ffffff;font-weight:700">${ci.phone} — ${ci.address}</div>
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:11px;color:rgba(255,255,255,.6)">طُبع: ${timeStr}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">${dateStr}</div>
      </div>
    </div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.2)">
      <div style="font-size:20px;font-weight:900;color:#fff">${opts.title}</div>
      ${opts.subtitle ? `<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px">${opts.subtitle}</div>` : ''}
      ${opts.dateRange ? `<div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:2px">📅 الفترة: ${opts.dateRange}</div>` : ''}
    </div>
  </div>

  ${kpisHTML}

  <!-- ══ DATA TABLE ══ -->
  <div class="tbl-scroll">
  <table class="r-report-tbl">
    ${theadHTML}
    <tbody>${tbodyHTML}</tbody>
    ${tfootHTML}
  </table>
  </div>

  ${notesSection}

  <div class="r-thanks">
    <div class="r-thanks-main">🌟 ${ci.thanks}</div>
    <div class="r-thanks-date">${opts.title} | ${dateStr}</div>
  </div>

  <div class="r-back-btn">
    <button onclick="if(window.opener||window.history.length<=1){window.close()}else{window.history.back()}">← رجوع / إغلاق</button>
  </div>

</div>
</body>
</html>`;
};

/* ── Open unified print window helper ──────────────────────────── */
export const printUnifiedReport = (opts: UnifiedReportOptions): void => {
  const html = buildUnifiedReportHTML(opts);
  const win  = window.open('', '_blank');
  if (!win) {
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
      if (!a) alert('يرجى السماح بالنوافذ المنبثقة في المتصفح ثم المحاولة مجدداً.');
    } catch { alert('تعذّر فتح صفحة الطباعة. يرجى السماح بالنوافذ المنبثقة.'); }
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
};

/* ═══════════════════════════════════════════════════════════════════
   DAILY SALES PRINT
═══════════════════════════════════════════════════════════════════ */
export interface DailySalesPrintRow {
  time: string;
  productName: string;
  customerName: string;
  quantity: number;
  unit: string;
  salePrice: number;
  purchasePrice?: number;
  profitKnown?: boolean;
  isPaid: boolean;
  status: string;
  initialPaid?: number;    /* الكاش لحظة إنشاء الفاتورة */
  laterCollections?: number; /* دفعات لاحقة على نفس الفاتورة */
  totalPaid?: number;       /* إجمالي المدفوع */
  totalAmount?: number;     /* إجمالي الفاتورة */
}

export interface DailyTxnRow {
  type: string;
  detail: string;
  amount: number;
  isInflow: boolean;
}

export const buildDailySalesPrintHTML = (params: {
  dateStr: string;
  rows: DailySalesPrintRow[];
  totalSalesAmount: number;
  totalInvoices: number;
  txns?: DailyTxnRow[];
  openingBalance?: number;
  totalMoneyIn?: number;
  totalMoneyOut?: number;
  cashOnHand?: number;
  totalProfit?: number;
  hasProfit?: boolean;
  totalCashSales?: number;      /* إجمالي الكاش الأولي */
  totalLaterCollections?: number; /* إجمالي الدفعات اللاحقة */
}): string => {
  const { dateStr, rows, totalSalesAmount, totalInvoices, txns = [], openingBalance = 0, totalMoneyIn, totalMoneyOut, cashOnHand, totalProfit, hasProfit, totalCashSales, totalLaterCollections } = params;
  const ci   = getCompanyInfo();
  const logo = getLogoURL();
  const now  = new Date();
  const dateNow = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeNow = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  const rowsHTML = rows.map(r => {
    const total = r.salePrice > 0 ? r.salePrice * r.quantity : (r.totalAmount || 0);
    const profit = r.profitKnown && r.purchasePrice != null ? r.salePrice * r.quantity - r.purchasePrice * r.quantity : null;
    const profitCell = profit !== null
      ? `<td style="padding:4px 3px;font-size:10px;font-weight:900;text-align:center;white-space:nowrap;color:${profit>=0?'#006600':'#cc0000'}">${profit>=0?'+':''}${fmt(profit)}</td>`
      : `<td style="padding:4px 3px;font-size:10px;text-align:center;color:#aaa">—</td>`;

    /* بناء خلية المدفوع مع الفصل بين الكاش الأولي والدفعات اللاحقة */
    const initPaid = r.initialPaid ?? (r.totalPaid || 0);
    const laterAmt = r.laterCollections || 0;
    const paidCell = (() => {
      const remaining = Math.max(0, (r.totalAmount || total) - (r.totalPaid || initPaid + laterAmt));
      const initColor = initPaid >= (r.totalAmount || total) ? '#006600' : initPaid > 0 ? '#b45309' : '#cc0000';
      return `<td style="padding:4px 3px;font-size:10px;text-align:center;white-space:nowrap">
  <span style="font-weight:900;color:${initColor}">${fmtEGP(initPaid)}</span>
  ${laterAmt > 0 ? `<br/><span style="font-size:9px;color:#1d4ed8;font-weight:700">+${fmtEGP(laterAmt)} تحصيل</span>` : ''}
  ${remaining > 0 ? `<br/><span style="font-size:9px;color:#cc0000">باقي ${fmtEGP(remaining)}</span>` : (r.totalPaid ?? initPaid) > 0 ? `<br/><span style="font-size:8px;color:#006600;font-weight:700">✓ مسدَّد</span>` : ''}
</td>`;
    })();

    return `<tr>
  <td style="padding:4px 3px;font-size:9px;color:#333;white-space:nowrap">${r.time}</td>
  <td style="padding:4px 3px;font-size:10px;font-weight:700;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px" title="${r.productName}">${r.productName}</td>
  <td style="padding:4px 3px;font-size:10px;font-weight:700;color:#8a6118;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${r.customerName}">${r.customerName}</td>
  <td style="padding:4px 3px;font-size:10px;font-weight:700;color:#000;text-align:center;white-space:nowrap">${r.quantity.toLocaleString('ar-EG')}${r.unit ? ' '+r.unit : ''}</td>
  <td style="padding:4px 3px;font-size:10px;font-weight:900;color:#000;text-align:center;white-space:nowrap">${total > 0 ? fmtEGP(total) : '—'}</td>
  ${paidCell}
  ${profitCell}
  <td style="padding:4px 3px;font-size:9px;text-align:center;white-space:nowrap"><span style="display:inline-block;padding:1px 3px;border-radius:4px;font-size:8px;font-weight:700;background:${r.isPaid?'#dcfce7':'#dbeafe'};color:${r.isPaid?'#166534':'#1d4ed8'}">${r.status}</span></td>
</tr>`;
  }).join('');

  const txnsHTML = txns.length > 0 ? `
<hr class="r-dash"/>
<div class="r-section">المعاملات الأخرى (${txns.length})</div>
<div class="tbl-scroll">
<table class="daily-tbl" style="margin-top:6px">
  <thead>
    <tr>
      <th>النوع</th>
      <th>البيان</th>
      <th style="width:100px;text-align:center">المبلغ</th>
    </tr>
  </thead>
  <tbody>
    ${txns.map((t: DailyTxnRow) => `<tr>
      <td style="padding:6px 8px;white-space:nowrap">
        <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;background:${t.isInflow?'#dcfce7':'#fee2e2'};color:${t.isInflow?'#166534':'#991b1b'}">${t.type}</span>
      </td>
      <td style="padding:6px 8px;font-size:13px;color:#000">${t.detail}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:900;text-align:center;white-space:nowrap;color:${t.isInflow?'#006600':'#cc0000'}">${t.isInflow?'+':'-'}${fmt(t.amount)}</td>
    </tr>`).join('')}
  </tbody>
</table>
</div>` : '';

  const cashSummaryHTML = cashOnHand !== undefined ? `
<hr class="r-dash"/>
<div class="r-section">ملخص الخزنة</div>
<div class="r-totals">
  ${openingBalance > 0 ? `<div class="r-total-row"><span class="r-total-lbl">رصيد البداية:</span><span class="r-total-val">${fmtEGP(openingBalance)}</span></div>` : ''}
  ${totalCashSales !== undefined && totalCashSales > 0 ? `<div class="r-total-row"><span class="r-total-lbl">↙ كاش إنشاء الفواتير:</span><span class="r-total-val" style="color:#006600">+${fmtEGP(totalCashSales)}</span></div>` : ''}
  ${totalLaterCollections !== undefined && totalLaterCollections > 0 ? `<div class="r-total-row"><span class="r-total-lbl">↙ تحصيلات لاحقة كاش:</span><span class="r-total-val" style="color:#0284c7">+${fmtEGP(totalLaterCollections)}</span></div>` : ''}
  ${totalMoneyIn !== undefined ? `<div class="r-total-row"><span class="r-total-lbl">إجمالي الوارد (+):</span><span class="r-total-val" style="color:#006600;font-weight:900">+${fmtEGP(totalMoneyIn - openingBalance)}</span></div>` : ''}
  ${totalMoneyOut !== undefined ? `<div class="r-total-row"><span class="r-total-lbl">إجمالي الصادر (-):</span><span class="r-total-val" style="color:#cc0000">-${fmtEGP(totalMoneyOut)}</span></div>` : ''}
  ${hasProfit && totalProfit !== undefined ? `<div class="r-total-row"><span class="r-total-lbl">صافي ربح اليوم:</span><span class="r-total-val" style="color:${totalProfit>=0?'#006600':'#cc0000'}">${fmtEGP(totalProfit)}</span></div>` : ''}
  <div class="r-total-row r-total-grand">
    <span class="r-total-lbl">▶ الإجمالي:</span>
    <span class="r-total-val" style="color:${cashOnHand>=0?'#ffffff':'#ffaaaa'}">${fmtEGP(cashOnHand)}</span>
  </div>
</div>` : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <meta name="color-scheme" content="light only"/>
  <title>يومية ${dateStr}</title>
  <style>${THERMAL_CSS}
  /* ── Daily overrides ── */
  @media screen {
    .receipt { max-width:760px; overflow-x:visible; }
    .tbl-scroll { overflow-x:auto!important; -webkit-overflow-scrolling:touch; }
  }
  .daily-hdr-card {
    background: linear-gradient(135deg,#a97a1f,#4d350d);
    border-radius:10px;
    padding:14px 16px;
    margin-bottom:10px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
    border:2px solid #a97a1f;
  }
  .daily-hdr-card .card-label { font-size:12px; color:rgba(255,255,255,.7); font-weight:600 }
  .daily-hdr-card .card-value { font-size:20px; color:#fff; font-weight:900; margin-top:2px }
  .daily-hdr-card .card-count { font-size:13px; color:rgba(255,255,255,.85); text-align:left }
  .daily-tbl { width:100%; border-collapse:collapse; font-size:13px; direction:rtl; table-layout:auto; border:1.5px solid #000; }
  .daily-tbl thead tr {
    background:linear-gradient(135deg,#a97a1f,#4d350d);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .daily-tbl thead th {
    padding:5px 4px;
    font-size:9px;
    font-weight:700;
    color:#fff;
    text-align:right;
    white-space:nowrap;
    border:1px solid rgba(255,255,255,.2);
  }
  .daily-tbl tbody tr { border-bottom:1px solid #ddd; }
  .daily-tbl tbody tr:nth-child(even) td { background:#f8fafb; }
  .daily-tbl tbody tr:last-child { border-bottom:1px solid #bbb; }
  .daily-tbl tbody td { border:1px solid #e8e8e8; padding:4px 4px; white-space:nowrap !important; overflow:hidden; text-overflow:ellipsis; max-width:150px; font-size:10px; }
  .daily-tbl tfoot tr {
    background:linear-gradient(135deg,#a97a1f,#4d350d);
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .daily-tbl tfoot td {
    padding:6px 5px;
    font-size:11px;
    font-weight:700;
    color:#fff;
    text-align:right;
    white-space:nowrap;
    border:1px solid rgba(255,255,255,.2);
  }
  @media print {
    @page { size:A4 landscape; margin:8mm 6mm; }
    .daily-hdr-card,
    .daily-tbl thead tr,
    .daily-tbl tfoot tr {
      -webkit-print-color-adjust:exact!important;
      print-color-adjust:exact!important;
    }
  }
  </style>
</head>
<body>
<div class="receipt">

  <!-- ══ DAILY HEADER ══ -->
  <div style="background:linear-gradient(135deg,#a97a1f,#4d350d);border-radius:10px;padding:14px 16px;margin-bottom:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${logo}" alt="${ci.name}" style="width:46px;height:46px;object-fit:contain;border-radius:6px;border:2px solid rgba(255,255,255,.3)" onerror="this.style.display='none'"/>
        <div>
          <div style="font-size:17px;font-weight:900;color:#fff">${ci.name}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.7)">☏ ${ci.phone}</div>
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:14px;font-weight:700;color:#fff">يومية ${dateStr}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.65);margin-top:2px">${dateNow}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6)">طُبع: ${timeNow}</div>
      </div>
    </div>
  </div>

  <div class="daily-hdr-card">
    <div>
      <div class="card-label">مبيعات اليوم</div>
      <div class="card-value">${fmtEGP(totalSalesAmount)}</div>
    </div>
    <div class="card-count">
      <div style="font-size:13px;font-weight:700">${totalInvoices} فاتورة</div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">${rows.length} صنف مباع</div>
    </div>
  </div>

  <!-- ══ DAILY SALES TABLE — scrollable on small screens ══ -->
  <div class="tbl-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table class="daily-tbl" style="min-width:520px">
      <thead>
        <tr>
          <th style="width:40px">الوقت</th>
          <th style="min-width:100px">المنتج</th>
          <th style="min-width:80px">العميل</th>
          <th style="width:40px;text-align:center">العدد</th>
          <th style="width:76px;text-align:center">الإجمالي</th>
          <th style="width:90px;text-align:center">المدفوع</th>
          <th style="width:68px;text-align:center">الربح</th>
          <th style="width:44px;text-align:center">الحالة</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#aaa">لا توجد مبيعات</td></tr>'}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4">إجمالي ${totalInvoices} فاتورة — ${rows.length} صنف</td>
          <td style="text-align:center;font-weight:900">${fmtEGP(totalSalesAmount)}</td>
          <td style="text-align:center;font-size:9px">${totalCashSales !== undefined ? `كاش: ${fmtEGP(totalCashSales)}${totalLaterCollections ? ` | تحصيل: +${fmtEGP(totalLaterCollections)}` : ''}` : ''}</td>
          <td style="text-align:center">${hasProfit && totalProfit !== undefined ? fmtEGP(totalProfit) : ''}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>

  ${txnsHTML}

  ${cashSummaryHTML}

  <div class="r-thanks">
    <div class="r-thanks-main">🌟 ${ci.thanks}</div>
    <div class="r-thanks-date">تقرير يوم ${dateStr}</div>
  </div>

  <div class="r-back-btn">
    <button onclick="if(window.opener||window.history.length<=1){window.close()}else{window.history.back()}">← رجوع / إغلاق</button>
  </div>

</div>
</body>
</html>`;
};

/* ═══════════════════════════════════════════════════════════════════
   LEDGER / DAILY REPORT
═══════════════════════════════════════════════════════════════════ */
export interface LedgerRow {
  seq: number; time: string; type: string; detail: string;
  inflow: number; outflow: number; balance: number;
}

export const buildLedgerPrintHTML = (params: {
  title: string; dateStr: string; openingBalance: number;
  rows: LedgerRow[]; totalIn: number; totalOut: number; closingBalance: number;
}): string => {
  const { title, dateStr, openingBalance, rows, totalIn, totalOut, closingBalance } = params;
  const ci      = getCompanyInfo();
  const logo    = getLogoURL();
  const now     = new Date();
  const dateNow = now.toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const timeNow = now.toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit' });

  const rowsHTML = rows.map(r => `
<tr>
  <td style="font-size:12px;font-weight:700;color:#000;word-break:break-word;line-height:1.4">
    ${r.detail}
    <span style="display:block;font-size:11px;color:#555;font-weight:400;margin-top:2px">${r.time} | ${r.type}</span>
  </td>
  <td style="text-align:center;font-size:14px;font-weight:900;color:${r.inflow>0?'#006600':'#bbb'};white-space:nowrap">
    ${r.inflow>0 ? '+'+fmt(r.inflow) : '—'}
  </td>
  <td style="text-align:center;font-size:14px;font-weight:900;color:${r.outflow>0?'#cc0000':'#bbb'};white-space:nowrap">
    ${r.outflow>0 ? '-'+fmt(r.outflow) : '—'}
  </td>
  <td style="text-align:center;font-size:14px;font-weight:900;color:${r.balance>=0?'#000':'#cc0000'};white-space:nowrap">
    ${fmt(r.balance)}
  </td>
</tr>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <meta name="color-scheme" content="light only"/>
  <title>${title} — ${dateStr}</title>
  <style>${THERMAL_CSS}</style>
</head>
<body>
<div class="receipt">

  <!-- ══ LEDGER HEADER ══ -->
  <div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:10px;padding:14px 16px;margin-bottom:10px;-webkit-print-color-adjust:exact;print-color-adjust:exact">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${logo}" alt="${ci.name}" style="width:44px;height:44px;object-fit:contain;border-radius:6px;border:2px solid rgba(255,255,255,.25)" onerror="this.style.display='none'"/>
        <div>
          <div style="font-size:16px;font-weight:900;color:#fff">${ci.name}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6)">☏ ${ci.phone}</div>
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:14px;font-weight:700;color:#fff">${title}</div>
        <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,.75);margin-top:2px">${dateStr}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.5)">طُبع: ${timeNow}</div>
      </div>
    </div>
  </div>

  <div class="r-section">ملخص الخزنة</div>
  <div class="r-totals">
    <div class="r-total-row">
      <span class="r-total-lbl">رصيد البداية:</span>
      <span class="r-total-val" style="color:#000066">${fmtEGP(openingBalance)}</span>
    </div>
    <div class="r-total-row">
      <span class="r-total-lbl">إجمالي الوارد:</span>
      <span class="r-total-val" style="color:#006600;font-size:16px;font-weight:900">+${fmtEGP(totalIn)}</span>
    </div>
    <div class="r-total-row">
      <span class="r-total-lbl">إجمالي الصادر:</span>
      <span class="r-total-val" style="color:#cc0000;font-size:16px;font-weight:900">-${fmtEGP(totalOut)}</span>
    </div>
    <div class="r-total-row r-total-grand">
      <span class="r-total-lbl">صافي الخزنة:</span>
      <span class="r-total-val" style="color:${closingBalance >= 0 ? '#ffffff' : '#ffaaaa'}">${fmtEGP(closingBalance)}</span>
    </div>
  </div>

  ${rows.length > 0 ? `
  <hr class="r-dash"/>
  <div class="r-section">الحركات (${rows.length})</div>
  <table class="r-items-table" style="margin-top:6px">
    <colgroup>
      <col style="width:auto"/>
      <col style="width:72px"/>
      <col style="width:72px"/>
      <col style="width:78px"/>
    </colgroup>
    <thead>
      <tr>
        <th>البيان</th>
        <th style="text-align:center">وارد</th>
        <th style="text-align:center">صادر</th>
        <th style="text-align:center">الرصيد</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHTML}
    </tbody>
  </table>
  ` : ''}

  <div class="r-thanks">
    <div class="r-thanks-main">🌟 ${ci.thanks}</div>
    <div class="r-thanks-date">تقرير يوم ${dateStr}</div>
  </div>

  <div class="r-back-btn">
    <button onclick="if(window.opener||window.history.length<=1){window.close()}else{window.history.back()}">← رجوع / إغلاق</button>
  </div>

</div>
</body>
</html>`;
};
