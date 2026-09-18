import { useState, useMemo, type ElementType } from 'react';
import {
  Archive, AlertTriangle, TrendingUp, TrendingDown,
  DollarSign, Printer, Search, Package, Trash2,
  Calendar, Users, Target, BarChart3,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { printUnifiedReport } from '@/lib/printInvoice';

type Tab = 'inventory' | 'shortages' | 'movement' | 'inbound' | 'outbound' | 'financial' | 'profit' | 'damaged' | 'workers' | 'showrooms' | 'reconciliation';

const fmt = (n: unknown) => { const v = Number(n) || 0; return v.toLocaleString('ar-EG'); };
const EGP = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG', { minimumFractionDigits: 0 }) + ' ج.م'; };

const TABS: { id: Tab; label: string; icon: ElementType; color: string; bg: string; desc: string }[] = [
  { id: 'inventory', label: 'جرد المخزون',   icon: Archive,       color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',   desc: 'كميات المنتجات الحالية' },
  { id: 'shortages', label: 'النواقص',        icon: AlertTriangle, color: 'text-red-700',    bg: 'bg-red-50 border-red-200',     desc: 'منتجات دون الحد الأدنى' },
  { id: 'showrooms', label: 'جرد المعارض',   icon: Archive,       color: 'text-pink-700',   bg: 'bg-pink-50 border-pink-200',   desc: 'مخزون المعارض والصالات' },
  { id: 'movement',  label: 'حركة الأصناف',  icon: TrendingUp,    color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200', desc: 'المباع والمشترى لكل صنف' },
  { id: 'profit',    label: 'تقرير الأرباح', icon: Target,        color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200', desc: 'صافي الربح والهامش' },
  { id: 'inbound',   label: 'الوارد',         icon: Package,       color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200', desc: 'جميع فواتير الشراء' },
  { id: 'outbound',  label: 'الصادر',         icon: TrendingDown,  color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',  desc: 'جميع فواتير المبيعات' },
  { id: 'financial', label: 'التقييم المالي', icon: DollarSign,    color: 'text-gold-700',   bg: 'bg-gold-50 border-gold-200',   desc: 'قيمة المخزون والربح المحتمل' },
  { id: 'damaged',   label: 'الهالك',         icon: Trash2,        color: 'text-red-700',    bg: 'bg-red-50 border-red-200',     desc: 'سجلات التالف والمفقود' },
  { id: 'workers',        label: 'تقرير العمال',      icon: Users,         color: 'text-slate-700',  bg: 'bg-slate-50 border-slate-200', desc: 'المرتبات والسلف والمستحقات' },
  { id: 'reconciliation', label: 'توفيق المخزون',  icon: BarChart3,     color: 'text-cyan-700',   bg: 'bg-cyan-50 border-cyan-200',   desc: 'مقارنة المشتريات والمبيعات والعجز والخسائر' },
];

const SC: Record<string, string> = {
  'مكتملة': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'مكتمل':  'text-emerald-700 bg-emerald-50 border-emerald-200',
  'آجل':    'text-blue-700 bg-blue-50 border-blue-200',
  'جزئي':   'text-amber-700 bg-amber-50 border-amber-200',
  'معلقة':  'text-amber-700 bg-amber-50 border-amber-200',
  'ملغاة':  'text-red-700 bg-red-50 border-red-200',
};

const getInvStatus = (qty: number, min: number) => qty === 0 ? 'نافد' : qty < min ? 'منخفض' : 'وفير';
const getInvClass  = (s: string) =>
  s === 'وفير'   ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
  s === 'منخفض' ? 'text-amber-700 bg-amber-50 border-amber-200' :
                   'text-red-700 bg-red-50 border-red-200';

/* ─── KPI Box ─── */
const KPI = ({ label, value, sub, border, text }: { label: string; value: string | number; sub?: string; border: string; text: string }) => (
  <div className={`rounded-2xl p-4 border ${border} bg-white`}>
    <p className="text-xs text-slate-500 mb-1 font-medium">{label}</p>
    <p className={`text-xl font-black ${text} break-all leading-tight`}>{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
  </div>
);

/* ─── Section header ─── */
const SectionHeader = ({ icon: Icon, title, count, extra }: { icon: ElementType; title: string; count?: number; extra?: React.ReactNode }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-gold-600" />
      <span className="font-bold text-sm text-slate-800">{title}</span>
      {count !== undefined && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{count}</span>}
    </div>
    {extra}
  </div>
);

/* ─── Table wrapper ─── */
const TblBox = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="overflow-x-auto">
      {children}
    </div>
  </div>
);

/* ─── Standard thead ─── */
const Thead = ({ cols, gradient }: { cols: string[]; gradient?: string }) => (
  <thead>
    <tr style={{ background: gradient || 'linear-gradient(135deg,#1e293b,#334155)' }}>
      {cols.map(c => <th key={c}>{c}</th>)}
    </tr>
  </thead>
);

const Reports = () => {
  const { interact } = useInteraction();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('inventory');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  /* ── Queries ── */
  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-report'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,sku,purchase_price,price,unit,min_stock'),
    staleTime: 60000,
  });

  const { data: inventory = [], isLoading: invLoad } = useQuery({
    queryKey: ['inv-report'],
    queryFn: async () => {
      const [prods, inv, showInv] = await Promise.all([
        fetchAllRows<any>('products', 'id,name,sku,unit,min_stock,purchase_price,price'),
        fetchAllRows<any>('inventory', 'product_id,quantity'),
        fetchAllRows<any>('showroom_inventory', 'product_id,quantity'),
      ]);
      const totals: Record<string, number> = {};
      (inv || []).forEach((r: any) => { totals[r.product_id] = (totals[r.product_id] || 0) + r.quantity; });
      const srTotals: Record<string, number> = {};
      (showInv || []).forEach((r: any) => { srTotals[r.product_id] = (srTotals[r.product_id] || 0) + r.quantity; });
      return (prods || []).map((p: any) => ({ ...p, quantity: totals[p.id] || 0, showroomQty: srTotals[p.id] || 0 }));
    },
    staleTime: 60000,
  });

  const { data: purchases = [] } = useQuery({
    queryKey: ['pur-report', dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('purchases').select('id,supplier_name,total_amount,paid_amount,status,purchase_date,purchase_items(product_name,quantity,unit_price)').order('purchase_date', { ascending: false });
      if (dateFrom) q = q.gte('purchase_date', dateFrom);
      if (dateTo)   q = q.lte('purchase_date', dateTo);
      const { data } = await q; return (data ?? []) as any[];
    },
    staleTime: 30000,
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sal-report', dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('sales').select('id,customer_name,total_amount,paid_amount,discount,status,sale_date,sale_items(product_name,quantity,unit_price,total_price,product_id)').order('sale_date', { ascending: false });
      if (dateFrom) q = q.gte('sale_date', dateFrom);
      if (dateTo)   q = q.lte('sale_date', dateTo);
      const { data } = await q; return (data ?? []) as any[];
    },
    staleTime: 30000,
  });

  const { data: saleItemsAll = [] }     = useQuery({ queryKey: ['si-report'],          queryFn: async () => fetchAllRows<any>('sale_items', 'product_name,quantity,unit,product_id'), staleTime: 60000 });
  const { data: purchaseItemsAll = [] } = useQuery({ queryKey: ['pi-report'],          queryFn: async () => fetchAllRows<any>('purchase_items', 'product_name,quantity,unit'), staleTime: 60000 });
  const { data: workersData = [] }      = useQuery({ queryKey: ['workers-report'],     queryFn: async () => fetchAllRows<any>('user_profiles', 'id,full_name,username,email,role,phone,active,max_salary', { column: 'full_name' }), staleTime: 60000 });
  const { data: workerTxns = [] }       = useQuery({ queryKey: ['worker-txns-report'], queryFn: async () => fetchAllRows<any>('worker_transactions', '*', { column: 'transaction_date', ascending: false }), staleTime: 60000 });
  const { data: damages = [] }          = useQuery({ queryKey: ['damages'],            queryFn: async () => fetchAllRows<any>('damages', '*', { column: 'damage_date', ascending: false }), staleTime: 30000 });

  /* ── Reconciliation data ── */
  const { data: allPurchaseItems = [] } = useQuery({
    queryKey: ['recon-pi'],
    queryFn: async () => {
      return fetchAllRows<any>('purchase_items', 'product_id, product_name, quantity, unit_price');
    },
    staleTime: 60000,
  });

  const { data: allSaleItems = [] } = useQuery({
    queryKey: ['recon-si'],
    queryFn: async () => fetchAllRows<any>('sale_items', 'product_id, product_name, quantity, unit_price'),
    staleTime: 60000,
  });

  const { data: allDamagesItems = [] } = useQuery({
    queryKey: ['recon-damages'],
    queryFn: async () => fetchAllRows<any>('damages', 'product_name, quantity, unit_cost'),
    staleTime: 30000,
  });

  const { data: currentInventory = [] } = useQuery({
    queryKey: ['recon-inv'],
    queryFn: async () => fetchAllRows<any>('inventory', 'product_id, quantity, products(name, purchase_price)'),
    staleTime: 30000,
  });

  /* ── Reconciliation calculation ── */
  const reconciliationData = useMemo(() => {
    // Build maps
    const purchased: Record<string, { name: string; qty: number; cost: number }> = {};
    allPurchaseItems.forEach((pi: any) => {
      if (!pi.product_id) return;
      if (!purchased[pi.product_id]) purchased[pi.product_id] = { name: pi.product_name || '—', qty: 0, cost: pi.unit_price || 0 };
      purchased[pi.product_id].qty += pi.quantity || 0;
    });

    const sold: Record<string, number> = {};
    allSaleItems.forEach((si: any) => {
      if (!si.product_id) return;
      sold[si.product_id] = (sold[si.product_id] || 0) + (si.quantity || 0);
    });

    const damaged: Record<string, number> = {};
    allDamagesItems.forEach((d: any) => {
      // damages by product_name only, match by name
    });

    const actual: Record<string, number> = {};
    currentInventory.forEach((inv: any) => {
      if (!inv.product_id) return;
      actual[inv.product_id] = (actual[inv.product_id] || 0) + (inv.quantity || 0);
    });

    const prodMap: Record<string, { name: string; pp: number }> = {};
    currentInventory.forEach((inv: any) => {
      if (!inv.product_id) return;
      prodMap[inv.product_id] = {
        name: (inv.products as any)?.name || '—',
        pp: (inv.products as any)?.purchase_price || 0,
      };
    });
    // also add from purchased
    Object.entries(purchased).forEach(([id, p]) => {
      if (!prodMap[id]) prodMap[id] = { name: p.name, pp: p.cost };
    });

    return Object.entries(prodMap)
      .filter(([id]) => (purchased[id]?.qty || 0) > 0 || (actual[id] || 0) > 0)
      .map(([id, prod]) => {
        const purchasedQty = purchased[id]?.qty || 0;
        const soldQty = sold[id] || 0;
        const expectedQty = purchasedQty - soldQty;
        const actualQty = actual[id] || 0;
        const deficit = Math.max(0, expectedQty - actualQty);
        const surplus = Math.max(0, actualQty - expectedQty);
        const unitCost = prod.pp || purchased[id]?.cost || 0;
        const deficitValue = deficit * unitCost;
        return {
          id, name: prod.name, purchasedQty, soldQty, expectedQty, actualQty,
          deficit, surplus, unitCost, deficitValue,
        };
      })
      .filter(r => !search || r.name.includes(search))
      .sort((a, b) => b.deficitValue - a.deficitValue);
  }, [allPurchaseItems, allSaleItems, currentInventory, search]);

  const totalPurchasedQty = reconciliationData.reduce((s, r) => s + r.purchasedQty, 0);
  const totalSoldQty = reconciliationData.reduce((s, r) => s + r.soldQty, 0);
  const totalExpectedQty = reconciliationData.reduce((s, r) => s + r.expectedQty, 0);
  const totalActualQty = reconciliationData.reduce((s, r) => s + r.actualQty, 0);
  const totalDeficit = reconciliationData.reduce((s, r) => s + r.deficit, 0);
  const totalDeficitValue = reconciliationData.reduce((s, r) => s + r.deficitValue, 0);

  const { data: showroomInvData = [] } = useQuery({
    queryKey: ['showroom-inv-report'],
    queryFn: async () => {
      const [{ data: showrooms }, { data: inv }] = await Promise.all([
        supabase.from('showrooms').select('id,name,location'),
        supabase.from('showroom_inventory').select('showroom_id,product_id,product_name,quantity'),
      ]);
      const showroomMap: Record<string, string> = {};
      (showrooms || []).forEach((s: any) => { showroomMap[s.id] = s.name; });
      const result: Record<string, { showroom: string; products: any[] }> = {};
      (inv || []).forEach((r: any) => {
        const name = showroomMap[r.showroom_id] || r.showroom_id;
        if (!result[r.showroom_id]) result[r.showroom_id] = { showroom: name, products: [] };
        result[r.showroom_id].products.push(r);
      });
      return Object.values(result);
    },
    staleTime: 60000,
  });

  const delDamageMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('damages').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['damages'] }); interact('delete'); toast.success('تم الحذف'); },
  });

  /* ── Computed ── */
  const filteredInv  = useMemo(() => inventory.filter(i => !search || i.name.includes(search) || (i.sku || '').includes(search)), [inventory, search]);
  const shortages    = useMemo(() => filteredInv.filter(i => (i.quantity + (i.showroomQty || 0)) < (i.min_stock || 0)).sort((a: any, b: any) => ((b.min_stock||0)-(b.quantity+(b.showroomQty||0)))-((a.min_stock||0)-(a.quantity+(a.showroomQty||0)))), [filteredInv]);
  const filteredPurchases = useMemo(() => purchases.filter(p => !search || (p.supplier_name||'').includes(search) || (p.purchase_items||[]).some((it:any)=>it.product_name.includes(search))), [purchases, search]);
  const filteredSales     = useMemo(() => sales.filter(s => !search || (s.customer_name||'').includes(search) || (s.sale_items||[]).some((it:any)=>it.product_name.includes(search))), [sales, search]);

  const showroomFlatRows = useMemo(() => {
    const rows: any[] = [];
    showroomInvData.forEach((sr: any) => {
      sr.products.forEach((p: any) => {
        if (!search || p.product_name.includes(search) || sr.showroom.includes(search))
          rows.push({ showroom: sr.showroom, product_name: p.product_name, quantity: p.quantity });
      });
    });
    return rows.sort((a, b) => b.quantity - a.quantity);
  }, [showroomInvData, search]);

  const productMovement = useMemo(() => {
    const map = new Map<string, { name: string; sold: number; purchased: number }>();
    for (const it of saleItemsAll)     { const e = map.get(it.product_name) || { name: it.product_name, sold: 0, purchased: 0 }; e.sold += it.quantity; map.set(it.product_name, e); }
    for (const it of purchaseItemsAll) { const e = map.get(it.product_name) || { name: it.product_name, sold: 0, purchased: 0 }; e.purchased += it.quantity; map.set(it.product_name, e); }
    return Array.from(map.values()).filter(p => !search || p.name.includes(search)).sort((a, b) => b.sold - a.sold);
  }, [saleItemsAll, purchaseItemsAll, search]);

  const financialData = useMemo(() => filteredInv.filter(i=>(i.quantity+(i.showroomQty||0))>0&&(i.purchase_price||0)>0).map(i=>{
    const pp=i.purchase_price||0; const sp=i.price||0; const qty=i.quantity+(i.showroomQty||0);
    return { name:i.name, sku:i.sku, qty, pp, sp, costVal:qty*pp, saleVal:sp>0?qty*sp:0, profit:sp>0?qty*(sp-pp):0 };
  }).sort((a,b)=>b.costVal-a.costVal), [filteredInv]);

  const totalFinPP  = useMemo(() => financialData.reduce((s,r)=>s+r.costVal,0), [financialData]);
  const totalFinSP  = useMemo(() => financialData.reduce((s,r)=>s+r.saleVal,0), [financialData]);
  const totalFinPft = useMemo(() => financialData.reduce((s,r)=>s+r.profit,0), [financialData]);

  const profitData = useMemo(() => {
    const rows: any[] = [];
    for (const sale of filteredSales) {
      for (const item of (sale.sale_items||[])) {
        const prod = allProducts.find((p:any)=>p.id===item.product_id);
        const bp = prod?.purchase_price||0;
        const rev = item.total_price||item.quantity*item.unit_price;
        rows.push({ product:item.product_name, qty:item.quantity, bp, sp:item.unit_price, rev, cost:bp*item.quantity, profit:bp>0?rev-bp*item.quantity:0, date:sale.sale_date, customer:sale.customer_name||'نقدي' });
      }
    }
    return rows.sort((a,b)=>b.profit-a.profit);
  }, [filteredSales, allProducts]);

  const totalRev  = useMemo(()=>profitData.reduce((s,r)=>s+r.rev,0),[profitData]);
  const totalCost = useMemo(()=>profitData.reduce((s,r)=>s+r.cost,0),[profitData]);
  const totalPft  = useMemo(()=>profitData.reduce((s,r)=>s+r.profit,0),[profitData]);
  const avgMargin = totalRev>0?(totalPft/totalRev)*100:0;

  const workerSummary = useMemo(()=>workersData.map((w:any)=>{
    const txns = workerTxns.filter((t:any)=>t.worker_id===w.id);
    const collected = txns.filter((t:any)=>t.type==='قبض').reduce((s:number,t:any)=>s+t.amount,0);
    const advances  = txns.filter((t:any)=>t.type==='سلفة').reduce((s:number,t:any)=>s+t.amount,0);
    return { ...w, collected, advances, net:advances-collected };
  }),[workersData,workerTxns]);

  /* ── Print ── */
  const handlePrint = () => {
    interact('click');
    const dateRange = (dateFrom || dateTo) ? `${dateFrom || '...'} ← ${dateTo || '...'}` : undefined;
    const F = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 0 }) + ' ج.م';
    const N = (v: number) => v.toLocaleString('ar-EG');

    if (activeTab === 'inventory' || activeTab === 'shortages') {
      const data = activeTab === 'inventory' ? filteredInv : shortages;
      const invVal = data.reduce((s: number, i: any) => s + ((i.quantity + (i.showroomQty || 0)) * (i.purchase_price || 0)), 0);
      printUnifiedReport({
        title: activeTab === 'inventory' ? 'جرد المخزون' : 'المنتجات دون الحد الأدنى',
        dateRange,
        kpis: [
          { label: 'إجمالي الأصناف', value: String(data.length) },
          { label: 'وفير', value: String(data.filter((i: any) => (i.quantity+(i.showroomQty||0))>=(i.min_stock||0)&&(i.quantity+(i.showroomQty||0))>0).length), color: '#16a34a' },
          { label: 'منخفض', value: String(data.filter((i: any) => (i.quantity+(i.showroomQty||0))>0&&(i.quantity+(i.showroomQty||0))<(i.min_stock||0)).length), color: '#d97706' },
          { label: 'نافد', value: String(data.filter((i: any) => (i.quantity+(i.showroomQty||0))===0).length), color: '#dc2626' },
          { label: 'قيمة المخزون', value: F(invVal) },
        ],
        columns: [
          { label: 'اسم المنتج', key: 'name' },
          { label: 'الكمية', key: '_total', align: 'center' as const,
            format: (_v: any, row: any) => N((row.quantity||0)+(row.showroomQty||0)),
            color: (_v: any, row: any) => { const q=(row.quantity||0)+(row.showroomQty||0); return q===0?'#dc2626':q<(row.min_stock||0)?'#d97706':'#16a34a'; } },
          { label: 'سعر شراء', key: 'purchase_price', format: (v: any) => v>0?F(v):'—' },
          { label: 'سعر بيع', key: 'price', format: (v: any) => v>0?F(v):'—' },
          { label: 'القيمة', key: '_val', format: (_v: any, row: any) => { const q=(row.quantity||0)+(row.showroomQty||0); const pp=row.purchase_price||0; return pp>0?F(q*pp):'—'; }, color: () => '#8a6118' },
          { label: 'الحالة', key: '_status',
            format: (_v: any, row: any) => { const q=(row.quantity||0)+(row.showroomQty||0); const mn=row.min_stock||0; return q===0?'نافد':q<mn?'منخفض':'وفير'; },
            color: (_v: any, row: any) => { const q=(row.quantity||0)+(row.showroomQty||0); return q===0?'#dc2626':q<(row.min_stock||0)?'#d97706':'#16a34a'; } },
        ],
        rows: data,
      });
    } else if (activeTab === 'showrooms') {
      const totalQty = showroomFlatRows.reduce((s: number, r: any) => s + r.quantity, 0);
      printUnifiedReport({
        title: 'جرد المعارض',
        kpis: [
          { label: 'إجمالي الأصناف', value: String(showroomFlatRows.length) },
          { label: 'إجمالي الكميات', value: N(totalQty) },
        ],
        columns: [
          { label: 'المعرض', key: 'showroom' },
          { label: 'المنتج', key: 'product_name' },
          { label: 'الكمية', key: 'quantity', align: 'center' as const, format: (v: any) => N(v), color: (v: any) => v === 0 ? '#dc2626' : '#16a34a' },
        ],
        rows: showroomFlatRows,
        footerCells: { showroom: `${showroomFlatRows.length} صنف`, product_name: 'الإجمالي', quantity: N(totalQty) },
      });
    } else if (activeTab === 'inbound') {
      const totAmt = filteredPurchases.reduce((s: number,p: any)=>s+p.total_amount,0);
      const totPaid = filteredPurchases.reduce((s: number,p: any)=>s+p.paid_amount,0);
      printUnifiedReport({
        title: 'تقرير المشتريات الواردة', dateRange,
        kpis: [
          { label: 'عدد الفواتير', value: String(filteredPurchases.length) },
          { label: 'الإجمالي', value: F(totAmt) },
          { label: 'المدفوع', value: F(totPaid), color: '#16a34a' },
          { label: 'الباقي', value: F(totAmt-totPaid), color: '#dc2626' },
        ],
        columns: [
          { label: 'التاريخ', key: 'purchase_date' },
          { label: 'المورد', key: 'supplier_name', format: (v: any) => v||'—' },
          { label: 'المنتجات', key: '_products', format: (_v: any, row: any) => (row.purchase_items||[]).slice(0,3).map((it: any)=>it.product_name).join('، ') || '—' },
          { label: 'الإجمالي', key: 'total_amount', format: (v: any) => F(v), color: () => '#1e293b' },
          { label: 'المدفوع', key: 'paid_amount', format: (v: any) => F(v), color: () => '#16a34a' },
          { label: 'الباقي', key: '_rem', format: (_v: any,row: any) => F(row.total_amount-row.paid_amount), color: (_v: any,row: any) => row.total_amount>row.paid_amount?'#dc2626':'#16a34a' },
          { label: 'الحالة', key: 'status' },
        ],
        rows: filteredPurchases,
        footerCells: { purchase_date: `${filteredPurchases.length} فاتورة`, supplier_name: 'الإجمالي', _products: '', total_amount: F(totAmt), paid_amount: F(totPaid), _rem: F(totAmt-totPaid), status: '' },
      });
    } else if (activeTab === 'outbound') {
      const totAmt = filteredSales.reduce((s: number,sl: any)=>s+sl.total_amount,0);
      const totPaid = filteredSales.reduce((s: number,sl: any)=>s+sl.paid_amount,0);
      printUnifiedReport({
        title: 'تقرير المبيعات الصادرة', dateRange,
        kpis: [
          { label: 'عدد الفواتير', value: String(filteredSales.length) },
          { label: 'الإجمالي', value: F(totAmt) },
          { label: 'المحصَّل', value: F(totPaid), color: '#16a34a' },
          { label: 'الباقي', value: F(totAmt-totPaid), color: '#dc2626' },
        ],
        columns: [
          { label: 'التاريخ', key: 'sale_date' },
          { label: 'العميل', key: 'customer_name', format: (v: any) => v||'نقدي' },
          { label: 'المنتجات', key: '_products', format: (_v: any, row: any) => (row.sale_items||[]).slice(0,3).map((it: any)=>it.product_name).join('، ') || '—' },
          { label: 'الإجمالي', key: 'total_amount', format: (v: any) => F(v), color: () => '#1e293b' },
          { label: 'المحصَّل', key: 'paid_amount', format: (v: any) => F(v), color: () => '#16a34a' },
          { label: 'الباقي', key: '_rem', format: (_v: any,row: any) => F(row.total_amount-row.paid_amount), color: (_v: any,row: any) => row.total_amount>row.paid_amount?'#dc2626':'#16a34a' },
          { label: 'الحالة', key: 'status' },
        ],
        rows: filteredSales,
        footerCells: { sale_date: `${filteredSales.length} فاتورة`, customer_name: 'الإجمالي', _products: '', total_amount: F(totAmt), paid_amount: F(totPaid), _rem: F(totAmt-totPaid), status: '' },
      });
    } else if (activeTab === 'profit') {
      printUnifiedReport({
        title: 'تقرير الأرباح', dateRange,
        kpis: [
          { label: 'إجمالي المبيعات', value: F(totalRev) },
          { label: 'إجمالي التكلفة', value: F(totalCost) },
          { label: 'صافي الربح', value: F(totalPft), color: totalPft>=0?'#16a34a':'#dc2626' },
          { label: 'هامش الربح', value: avgMargin.toFixed(1)+'%' },
        ],
        columns: [
          { label: 'الصنف', key: 'product' },
          { label: 'العميل', key: 'customer' },
          { label: 'التاريخ', key: 'date' },
          { label: 'الكمية', key: 'qty', align: 'center' as const },
          { label: 'سعر شراء', key: 'bp', format: (v: any) => v>0?F(v):'—' },
          { label: 'سعر بيع', key: 'sp', format: (v: any) => F(v) },
          { label: 'الإيراد', key: 'rev', format: (v: any) => F(v), color: () => '#8a6118' },
          { label: 'التكلفة', key: 'cost', format: (v: any) => v>0?F(v):'—' },
          { label: 'الربح', key: 'profit', format: (_v: any,row: any) => row.bp>0?F(row.profit):'—', color: (_v: any,row: any) => row.bp>0?(row.profit>=0?'#16a34a':'#dc2626'):'#94a3b8' },
        ],
        rows: profitData,
        footerCells: { product: `${profitData.length} سجل`, customer:'',date:'',qty:'',bp:'',sp:'',rev:F(totalRev),cost:F(totalCost),profit:F(totalPft) },
      });
    } else if (activeTab === 'movement') {
      printUnifiedReport({
        title: 'حركة الأصناف',
        kpis: [
          { label: 'أصناف متحركة', value: String(productMovement.length) },
          { label: 'إجمالي الصادر', value: N(saleItemsAll.reduce((s: number,i: any)=>s+i.quantity,0)), color:'#d97706' },
          { label: 'إجمالي الوارد', value: N(purchaseItemsAll.reduce((s: number,i: any)=>s+i.quantity,0)), color:'#16a34a' },
        ],
        columns: [
          { label: '#', key: '_idx', align: 'center' as const, format: (_v: any,_r: any,idx: any) => String((idx as number)+1) },
          { label: 'اسم الصنف', key: 'name' },
          { label: 'مباع', key: 'sold', align: 'center' as const, format: (v: any) => N(v), color: () => '#d97706' },
          { label: 'مشترى', key: 'purchased', align: 'center' as const, format: (v: any) => N(v), color: () => '#16a34a' },
        ],
        rows: productMovement,
      });
    } else if (activeTab === 'financial') {
      printUnifiedReport({
        title: 'التقييم المالي للمخزون',
        kpis: [
          { label: 'قيمة (شراء)', value: F(totalFinPP) },
          { label: 'قيمة (بيع)', value: F(totalFinSP), color:'#16a34a' },
          { label: 'الربح المحتمل', value: F(totalFinPft), color:'#d97706' },
        ],
        columns: [
          { label: 'اسم الصنف', key: 'name' },
          { label: 'الكمية', key: 'qty', align: 'center' as const, format: (v: any) => N(v) },
          { label: 'سعر شراء', key: 'pp', format: (v: any) => F(v) },
          { label: 'سعر بيع', key: 'sp', format: (v: any) => v>0?F(v):'—' },
          { label: 'قيمة (شراء)', key: 'costVal', format: (v: any) => F(v), color: () => '#8a6118' },
          { label: 'قيمة (بيع)', key: 'saleVal', format: (v: any) => v>0?F(v):'—', color: () => '#16a34a' },
          { label: 'ربح محتمل', key: 'profit', format: (v: any) => v>0?F(v):'—', color: () => '#d97706' },
        ],
        rows: financialData,
        footerCells: { name:`${financialData.length} صنف`,qty:'',pp:'',sp:'',costVal:F(totalFinPP),saleVal:F(totalFinSP),profit:F(totalFinPft) },
      });
    } else if (activeTab === 'damaged') {
      const totalLoss = (damages as any[]).reduce((s: number,d: any)=>s+d.quantity*(d.unit_cost||0),0);
      printUnifiedReport({
        title: 'تقرير الهالك والتالف',
        kpis: [
          { label: 'سجلات الهالك', value: String(damages.length) },
          { label: 'الكميات التالفة', value: N((damages as any[]).reduce((s: number,d: any)=>s+d.quantity,0)) },
          { label: 'تكلفة الهالك', value: F(totalLoss), color:'#dc2626' },
        ],
        columns: [
          { label: 'التاريخ', key: 'damage_date' },
          { label: 'اسم المنتج', key: 'product_name' },
          { label: 'الكمية', key: 'quantity', align: 'center' as const, color: () => '#dc2626' },
          { label: 'سعر التكلفة', key: 'unit_cost', format: (v: any) => v?F(v):'—' },
          { label: 'القيمة المفقودة', key: '_loss', format: (_v: any,row: any) => row.unit_cost?F(row.quantity*row.unit_cost):'—', color: () => '#dc2626' },
          { label: 'السبب', key: 'reason', format: (v: any) => v||'—' },
        ],
        rows: damages as any[],
        footerCells: { damage_date:`${damages.length} سجل`,product_name:'',quantity:'',unit_cost:'',_loss:F(totalLoss),reason:'' },
      });
    } else if (activeTab === 'workers') {
      const rMap: Record<string,string> = {admin:'مدير',warehouse_manager:'مدير مخزن',driver:'سائق',worker:'عامل',boss:'الرئيس'};
      const totalCollected = (workerTxns as any[]).filter((t: any)=>t.type==='قبض').reduce((s: number,t: any)=>s+t.amount,0);
      const totalAdvances = (workerTxns as any[]).filter((t: any)=>t.type==='سلفة').reduce((s: number,t: any)=>s+t.amount,0);
      printUnifiedReport({
        title: 'تقرير العمال والمرتبات',
        kpis: [
          { label: 'إجمالي العمال', value: String(workerSummary.length) },
          { label: 'إجمالي المقبوض', value: F(totalCollected), color:'#16a34a' },
          { label: 'إجمالي السلف', value: F(totalAdvances), color:'#d97706' },
        ],
        columns: [
          { label: 'العامل', key: 'full_name', format: (v: any,row: any) => v||row.username||'—' },
          { label: 'الوظيفة', key: 'role', format: (v: any) => rMap[v]||v },
          { label: 'الهاتف', key: 'phone', format: (v: any) => v||'—' },
          { label: 'الحد الأقصى', key: 'max_salary', format: (v: any) => v?F(v):'—' },
          { label: 'المقبوض', key: 'collected', format: (v: any) => v>0?F(v):'—', color: (v: any) => v>0?'#16a34a':undefined },
          { label: 'السلف', key: 'advances', format: (v: any) => v>0?F(v):'—', color: (v: any) => v>0?'#d97706':undefined },
          { label: 'المستحق', key: 'net', format: (v: any) => v>0?F(v):'—', color: (v: any) => v>0?'#dc2626':undefined },
          { label: 'الحالة', key: 'active', format: (v: any) => v!==false?'نشط':'معطّل', color: (v: any) => v!==false?'#16a34a':'#dc2626' },
        ],
        rows: workerSummary,
        footerCells: { full_name:`${workerSummary.length} عامل`,role:'',phone:'',max_salary:'',collected:F(totalCollected),advances:F(totalAdvances),net:F(workerSummary.reduce((s: number,w: any)=>s+(w.net||0),0)),active:'' },
      });
    } else {
      toast.error('هذا التقرير غير مدعوم بعد');
    }
  };

  if (invLoad) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  const activeTabInfo = TABS.find(t=>t.id===activeTab) || TABS[0];

  /* ─────────────── RENDER ─────────────── */
  return (
    <div className="space-y-5">

      {/* ── Hero Header ── */}
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-5 h-5 text-white/80" />
              <span className="text-xs text-white/70 font-medium">التقارير والتحليلات</span>
            </div>
            <p className="text-2xl font-black text-white">{activeTabInfo.label}</p>
            <p className="text-xs text-white/60 mt-1">{activeTabInfo.desc}</p>
          </div>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-gold-700 rounded-xl text-sm font-bold hover:bg-gold-50 transition-all shadow-sm">
            <Printer className="w-4 h-4" /><span>طباعة</span>
          </button>
        </div>
      </div>

      {/* ── Tabs Grid ── */}
      <div className="grid grid-cols-6 sm:grid-cols-6 lg:grid-cols-11 gap-1.5">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => { interact('click'); setActiveTab(tab.id); }}
              className={cn(
                'flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all',
                isActive
                  ? 'text-white border-transparent shadow-md'
                  : cn('bg-white border-slate-200 hover:border-gold-200 hover:bg-gold-50/30', tab.color)
              )}
              style={isActive ? { background: 'linear-gradient(135deg,#8a6118,#4d350d)' } : {}}>
              <Icon className={cn('w-4 h-4', isActive ? 'text-white' : tab.color)} />
              <span className={cn('text-xs font-bold leading-tight', isActive ? 'text-white' : 'text-slate-600')}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-xs text-slate-500 font-medium">بحث</label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" placeholder="منتج، عميل، مورد..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl py-2 pr-9 pl-3 text-sm focus:outline-none focus:border-gold-400" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 font-medium flex items-center gap-1"><Calendar className="w-3 h-3" />من</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-gold-400" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 font-medium flex items-center gap-1"><Calendar className="w-3 h-3" />إلى</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-gold-400" />
          </div>
          {(dateFrom || dateTo || search) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); }}
              className="px-3 py-2 bg-slate-100 text-slate-500 rounded-xl text-sm hover:bg-slate-200 transition-all">
              مسح
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ TAB CONTENT ══════════════ */}

      {/* Inventory / Shortages */}
      {(activeTab === 'inventory' || activeTab === 'shortages') && (() => {
        const data = activeTab === 'inventory' ? filteredInv : shortages;
        const wafir   = data.filter((i:any)=>(i.quantity+(i.showroomQty||0))>=(i.min_stock||0)&&(i.quantity+(i.showroomQty||0))>0).length;
        const low     = data.filter((i:any)=>(i.quantity+(i.showroomQty||0))>0&&(i.quantity+(i.showroomQty||0))<(i.min_stock||0)).length;
        const nafid   = data.filter((i:any)=>(i.quantity+(i.showroomQty||0))===0).length;
        const invVal  = data.reduce((s:number,i:any)=>s+((i.quantity+(i.showroomQty||0))*(i.purchase_price||0)),0);
        return (
          <div className="space-y-4 animate-fade-up">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPI label="إجمالي الأصناف" value={data.length} border="border-blue-200"    text="text-blue-700" />
              <KPI label="وفير"            value={wafir}      border="border-emerald-200"  text="text-emerald-700" />
              <KPI label="منخفض"           value={low}        border="border-amber-200"    text="text-amber-700" />
              <KPI label="نافد"            value={nafid}      border="border-red-200"      text="text-red-700" sub={`قيمة المخزون: ${EGP(invVal)}`} />
            </div>
            <TblBox>
              <SectionHeader icon={Archive} title={activeTab==='inventory'?'جرد المخزون الكامل':'المنتجات دون الحد الأدنى'} count={data.length} />
              <table className="daily-table min-w-[400px]">
                <Thead cols={['اسم المنتج','الكمية','سعر الشراء','سعر البيع','قيمة المخزون','الحالة']} />
                <tbody>
                  {data.map((item:any, i:number) => {
                    const qty=(item.quantity||0)+(item.showroomQty||0);
                    const st=getInvStatus(qty,item.min_stock||0);
                    const pp=item.purchase_price||0;
                    return (
                      <tr key={item.id||i} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{item.name}</td>
                        <td className="px-3 py-2.5 text-center font-black text-base whitespace-nowrap" style={{color:st==='نافد'?'#dc2626':st==='منخفض'?'#d97706':'#16a34a'}}>{qty}</td>
                        <td className="px-3 py-2.5 text-sm text-slate-500 whitespace-nowrap">{pp>0?EGP(pp):'—'}</td>
                        <td className="px-3 py-2.5 text-sm text-slate-500 whitespace-nowrap">{(item.price||0)>0?EGP(item.price):'—'}</td>
                        <td className="px-3 py-2.5 font-bold text-sm text-gold-700 whitespace-nowrap">{pp>0?EGP(qty*pp):'—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold',getInvClass(st))}>{st}</span></td>
                      </tr>
                    );
                  })}
                  {data.length===0&&<tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
                </tbody>
              </table>
            </TblBox>
          </div>
        );
      })()}

      {/* Showrooms */}
      {activeTab==='showrooms' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 gap-3">
            <KPI label="إجمالي الأصناف" value={showroomFlatRows.length} border="border-pink-200" text="text-pink-700" />
            <KPI label="إجمالي الكميات" value={fmt(showroomFlatRows.reduce((s:number,r:any)=>s+r.quantity,0))} border="border-gold-200" text="text-gold-700" />
          </div>
          <TblBox>
            <SectionHeader icon={Archive} title="جرد المعارض" count={showroomFlatRows.length} />
            <table className="daily-table min-w-[360px]">
              <Thead cols={['المعرض','المنتج','الكمية']} />
              <tbody>
                {showroomFlatRows.map((r:any,i:number)=>(
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-bold text-sm text-pink-700 whitespace-nowrap">{r.showroom}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-800 whitespace-nowrap">{r.product_name}</td>
                    <td className="px-3 py-2.5 font-black text-base text-center whitespace-nowrap" style={{color:r.quantity===0?'#dc2626':'#16a34a'}}>{r.quantity}</td>
                  </tr>
                ))}
                {showroomFlatRows.length===0&&<tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Inbound */}
      {activeTab==='inbound' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="عدد الفواتير" value={filteredPurchases.length} border="border-violet-200" text="text-violet-700" />
            <KPI label="الإجمالي"     value={EGP(filteredPurchases.reduce((s:number,p:any)=>s+p.total_amount,0))} border="border-blue-200" text="text-blue-700" />
            <KPI label="المدفوع"      value={EGP(filteredPurchases.reduce((s:number,p:any)=>s+p.paid_amount,0))}  border="border-emerald-200" text="text-emerald-700" />
            <KPI label="الباقي"       value={EGP(filteredPurchases.reduce((s:number,p:any)=>s+(p.total_amount-p.paid_amount),0))} border="border-red-200" text="text-red-700" />
          </div>
          <TblBox>
            <SectionHeader icon={Package} title="فواتير المشتريات" count={filteredPurchases.length} />
            <table className="daily-table min-w-[520px]">
              <Thead cols={['التاريخ','المورد','المنتجات','الإجمالي','المدفوع','الباقي','الحالة']} />
              <tbody>
                {filteredPurchases.map((p:any,i:number)=>{
                  const items=p.purchase_items||[];
                  const productNames = items.slice(0,2).map((it:any)=>it.product_name).join('، ')+(items.length>2?` +${items.length-2}`:'')||'—';
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{p.purchase_date}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{p.supplier_name||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">{productNames}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{EGP(p.total_amount)}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-emerald-600 whitespace-nowrap">{EGP(p.paid_amount)}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-red-500 whitespace-nowrap">{EGP(p.total_amount-p.paid_amount)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold whitespace-nowrap',SC[p.status]||'')}>{p.status}</span></td>
                    </tr>
                  );
                })}
                {filteredPurchases.length===0&&<tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Outbound */}
      {activeTab==='outbound' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="عدد الفواتير" value={filteredSales.length} border="border-amber-200" text="text-amber-700" />
            <KPI label="الإجمالي"     value={EGP(filteredSales.reduce((s:number,sl:any)=>s+sl.total_amount,0))} border="border-blue-200" text="text-blue-700" />
            <KPI label="المحصّل"      value={EGP(filteredSales.reduce((s:number,sl:any)=>s+sl.paid_amount,0))} border="border-emerald-200" text="text-emerald-700" />
            <KPI label="الباقي"       value={EGP(filteredSales.reduce((s:number,sl:any)=>s+(sl.total_amount-sl.paid_amount),0))} border="border-red-200" text="text-red-700" />
          </div>
          <TblBox>
            <SectionHeader icon={TrendingDown} title="فواتير المبيعات" count={filteredSales.length} />
            <table className="daily-table min-w-[520px]">
              <Thead cols={['التاريخ','العميل','المنتجات','الإجمالي','المحصّل','الباقي','الحالة']} />
              <tbody>
                {filteredSales.map((s:any,i:number)=>{
                  const items=s.sale_items||[];
                  const productNames = items.slice(0,2).map((it:any)=>it.product_name).join('، ')+(items.length>2?` +${items.length-2}`:'')||'—';
                  return (
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{s.sale_date}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{s.customer_name||'نقدي'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">{productNames}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{EGP(s.total_amount)}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-emerald-600 whitespace-nowrap">{EGP(s.paid_amount)}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-red-500 whitespace-nowrap">{EGP(s.total_amount-s.paid_amount)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold whitespace-nowrap',SC[s.status]||'')}>{s.status}</span></td>
                    </tr>
                  );
                })}
                {filteredSales.length===0&&<tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Movement */}
      {activeTab==='movement' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-3 gap-3">
            <KPI label="أصناف متحركة" value={productMovement.length} border="border-violet-200" text="text-violet-700" />
            <KPI label="إجمالي الصادر" value={fmt(saleItemsAll.reduce((s:number,i:any)=>s+i.quantity,0))} border="border-amber-200" text="text-amber-700" />
            <KPI label="إجمالي الوارد" value={fmt(purchaseItemsAll.reduce((s:number,i:any)=>s+i.quantity,0))} border="border-emerald-200" text="text-emerald-700" />
          </div>
          <TblBox>
            <SectionHeader icon={TrendingUp} title="حركة الأصناف" count={productMovement.length} />
            <table className="daily-table min-w-[360px]">
              <Thead cols={['#','اسم الصنف','مباع','مشترى']} />
              <tbody>
                {productMovement.map((p,i)=>(
                  <tr key={p.name} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-xs text-slate-400 text-center whitespace-nowrap">{i+1}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{p.name}</td>
                    <td className="px-3 py-2.5 font-black text-base text-amber-500 text-center whitespace-nowrap">{fmt(p.sold)}</td>
                    <td className="px-3 py-2.5 font-black text-base text-emerald-600 text-center whitespace-nowrap">{fmt(p.purchased)}</td>
                  </tr>
                ))}
                {productMovement.length===0&&<tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Profit */}
      {activeTab==='profit' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="إجمالي المبيعات" value={EGP(totalRev)}  border="border-blue-200"    text="text-blue-700" />
            <KPI label="إجمالي التكلفة"  value={EGP(totalCost)} border="border-violet-200"  text="text-violet-700" />
            <KPI label="صافي الربح"      value={EGP(totalPft)}  border={totalPft>=0?"border-emerald-200":"border-red-200"} text={totalPft>=0?"text-emerald-700":"text-red-700"} />
            <KPI label="هامش الربح"      value={avgMargin.toFixed(1)+'%'} border="border-amber-200" text="text-amber-700" />
          </div>
          <TblBox>
            <SectionHeader icon={Target} title="تفاصيل الأرباح" count={profitData.length} />
            <table className="daily-table min-w-[640px]">
              <Thead cols={['الصنف','العميل','التاريخ','الكمية','سعر الشراء','سعر البيع','الإيراد','التكلفة','الربح']} />
              <tbody>
                {profitData.map((r,i)=>(
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{r.product}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{r.customer}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-700 text-center whitespace-nowrap">{r.qty}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{r.bp>0?EGP(r.bp):'—'}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-700 whitespace-nowrap">{EGP(r.sp)}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-gold-700 whitespace-nowrap">{EGP(r.rev)}</td>
                    <td className="px-3 py-2.5 text-sm text-violet-500 whitespace-nowrap">{r.cost>0?EGP(r.cost):'—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('font-black text-sm',r.bp>0?(r.profit>=0?'text-emerald-600':'text-red-500'):'text-slate-300')}>{r.bp>0?EGP(r.profit):'—'}</span></td>
                  </tr>
                ))}
                {profitData.length===0&&<tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">تأكد من إدخال سعر الشراء للمنتجات وتحديد فترة زمنية</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Financial */}
      {activeTab==='financial' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-3 gap-3">
            <KPI label="قيمة المخزون (شراء)" value={EGP(totalFinPP)}  border="border-blue-200"   text="text-blue-700" />
            <KPI label="قيمة المخزون (بيع)"   value={EGP(totalFinSP)}  border="border-emerald-200" text="text-emerald-700" />
            <KPI label="الربح المحتمل"         value={EGP(totalFinPft)} border="border-amber-200"  text="text-amber-700" />
          </div>
          <TblBox>
            <SectionHeader icon={DollarSign} title="التقييم المالي للمخزون" count={financialData.length} />
            <table className="daily-table min-w-[580px]">
              <Thead cols={['اسم الصنف','الكمية','سعر الشراء','سعر البيع','قيمة (شراء)','قيمة (بيع)','ربح محتمل']} />
              <tbody>
                {financialData.map((r,i)=>(
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-700 text-center whitespace-nowrap">{fmt(r.qty)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-400 whitespace-nowrap">{EGP(r.pp)}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-400 whitespace-nowrap">{r.sp>0?EGP(r.sp):'—'}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-gold-700 whitespace-nowrap">{EGP(r.costVal)}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-emerald-600 whitespace-nowrap">{r.saleVal>0?EGP(r.saleVal):'—'}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-amber-500 whitespace-nowrap">{r.profit>0?EGP(r.profit):'—'}</td>
                  </tr>
                ))}
                {financialData.length===0&&<tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Damaged */}
      {activeTab==='damaged' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-3 gap-3">
            <KPI label="سجلات الهالك"    value={damages.length} border="border-red-200" text="text-red-700" />
            <KPI label="الكميات التالفة" value={fmt(damages.reduce((s:number,d:any)=>s+d.quantity,0))} border="border-orange-200" text="text-orange-700" />
            <KPI label="تكلفة الهالك"    value={EGP(damages.reduce((s:number,d:any)=>s+d.quantity*(d.unit_cost||0),0))} border="border-violet-200" text="text-violet-700" />
          </div>
          <TblBox>
            <SectionHeader icon={Trash2} title="سجلات الهالك والتالف" count={damages.length} />
            <table className="daily-table min-w-[480px]">
              <Thead cols={['التاريخ','اسم المنتج','الكمية','سعر التكلفة','القيمة المفقودة','السبب','حذف']} />
              <tbody>
                {damages.map((d:any,i:number)=>(
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{d.damage_date}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{d.product_name}</td>
                    <td className="px-3 py-2.5 font-black text-base text-red-500 text-center whitespace-nowrap">{d.quantity}</td>
                    <td className="px-3 py-2.5 text-sm text-slate-400 whitespace-nowrap">{d.unit_cost?EGP(d.unit_cost):'—'}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-red-600 whitespace-nowrap">{d.unit_cost?EGP(d.quantity*d.unit_cost):'—'}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{d.reason||'—'}</td>
                    <td className="px-3 py-2.5">
                      <button className="w-7 h-7 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg flex items-center justify-center transition-all border border-red-200"
                        onClick={()=>delDamageMutation.mutate(d.id)}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
                {damages.length===0&&<tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد سجلات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

      {/* Reconciliation */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="إجمالي المشتريات" value={fmt(totalPurchasedQty)} border="border-violet-200" text="text-violet-700" />
            <KPI label="إجمالي المبيعات" value={fmt(totalSoldQty)} border="border-amber-200" text="text-amber-700" />
            <KPI label="المخزون المتوقع" value={fmt(totalExpectedQty)} border="border-blue-200" text="text-blue-700" sub={`فعلي: ${fmt(totalActualQty)}`} />
            <KPI label="إجمالي العجز" value={fmt(totalDeficit)} border="border-red-200" text="text-red-700" sub={EGP(totalDeficitValue)} />
          </div>
          <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4">
            <p className="text-xs text-cyan-700 font-semibold mb-1">ℹ️ كيفية الحساب:</p>
            <p className="text-xs text-cyan-600">مخزون متوقع = إجمالي مشتريات − إجمالي مبيعات ┆ العجز = متوقع − فعلي ┆ الخسارة = عجز × سعر الشراء</p>
          </div>
          <TblBox>
            <SectionHeader icon={BarChart3} title="توفيق المخزون" count={reconciliationData.length} />
            <table className="daily-table min-w-[700px]">
              <Thead cols={['اسم المنتج', 'مشتريات', 'مبيعات', 'متوقع', 'فعلي', 'عجز', 'فائض', 'سعر الشراء', 'خسارة العجز']} gradient="linear-gradient(135deg,#0e7490,#0891b2)" />
              <tbody>
                {reconciliationData.map((r, i) => (
                  <tr key={r.id} className={cn('border-b border-slate-50 hover:bg-slate-50/60', r.deficit > 0 ? 'bg-red-50/30' : r.surplus > 0 ? 'bg-emerald-50/30' : '')}>
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-violet-600 text-center whitespace-nowrap">{fmt(r.purchasedQty)}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-amber-600 text-center whitespace-nowrap">{fmt(r.soldQty)}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-blue-600 text-center whitespace-nowrap">{fmt(r.expectedQty)}</td>
                    <td className="px-3 py-2.5 font-bold text-sm text-slate-700 text-center whitespace-nowrap">{fmt(r.actualQty)}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {r.deficit > 0
                        ? <span className="font-black text-sm text-red-600">{fmt(r.deficit)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {r.surplus > 0
                        ? <span className="font-black text-sm text-emerald-600">+{fmt(r.surplus)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-slate-400 whitespace-nowrap">{r.unitCost > 0 ? EGP(r.unitCost) : '—'}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {r.deficitValue > 0
                        ? <span className="font-black text-sm text-red-600">{EGP(r.deficitValue)}</span>
                        : <span className="text-emerald-500 text-xs font-semibold">✔ لا خسارة</span>}
                    </td>
                  </tr>
                ))}
                {reconciliationData.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات — تأكد من إدخال بيانات المشتريات والمبيعات</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(135deg,#0e7490,#0891b2)' }}>
                  <td className="px-3 py-3 text-xs font-bold text-white">{reconciliationData.length} صنف</td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">{fmt(totalPurchasedQty)}</td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">{fmt(totalSoldQty)}</td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">{fmt(totalExpectedQty)}</td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">{fmt(totalActualQty)}</td>
                  <td className="px-3 py-3 text-center font-black text-red-200 whitespace-nowrap">{totalDeficit > 0 ? fmt(totalDeficit) : '—'}</td>
                  <td className="px-3 py-3 text-center font-black text-emerald-200 whitespace-nowrap">{fmt(reconciliationData.reduce((s, r) => s + r.surplus, 0))}</td>
                  <td />
                  <td className="px-3 py-3 text-center font-black text-red-200 whitespace-nowrap">{totalDeficitValue > 0 ? EGP(totalDeficitValue) : '✔ لا خسائر'}</td>
                </tr>
              </tfoot>
            </table>
          </TblBox>
        </div>
      )}

      {/* Workers */}
      {activeTab==='workers' && (
        <div className="space-y-4 animate-fade-up">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="إجمالي العمال"   value={workersData.length} border="border-blue-200" text="text-blue-700" />
            <KPI label="نشطون"            value={workersData.filter((w:any)=>w.active!==false).length} border="border-emerald-200" text="text-emerald-700" />
            <KPI label="إجمالي المقبوض"  value={EGP(workerTxns.filter((t:any)=>t.type==='قبض').reduce((s:number,t:any)=>s+t.amount,0))} border="border-emerald-200" text="text-emerald-700" />
            <KPI label="إجمالي السلف"    value={EGP(workerTxns.filter((t:any)=>t.type==='سلفة').reduce((s:number,t:any)=>s+t.amount,0))} border="border-amber-200" text="text-amber-700" />
          </div>
          <TblBox>
            <SectionHeader icon={Users} title="بيانات العمال والمرتبات" count={workerSummary.length} />
            <table className="daily-table min-w-[540px]">
              <Thead cols={['العامل','الوظيفة','الهاتف','الحد الأقصى','المقبوض','السلف','المستحق','الحالة']} />
              <tbody>
                {workerSummary.map((w:any,i:number)=>{
                  const rMap:Record<string,string>={admin:'مدير',warehouse_manager:'مدير مخزن',driver:'سائق',worker:'عامل',boss:'الرئيس'};
                  return (
                    <tr key={w.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 font-bold text-sm text-slate-800 whitespace-nowrap">{w.full_name||w.username||'—'}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{rMap[w.role]||w.role}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{w.phone||'—'}</td>
                      <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{w.max_salary?EGP(w.max_salary):'—'}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-emerald-600 whitespace-nowrap">{w.collected>0?EGP(w.collected):'—'}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-amber-500 whitespace-nowrap">{w.advances>0?EGP(w.advances):'—'}</td>
                      <td className="px-3 py-2.5 font-bold text-sm text-red-500 whitespace-nowrap">{w.net>0?EGP(w.net):'—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold',w.active!==false?'text-emerald-700 bg-emerald-50 border-emerald-200':'text-red-700 bg-red-50 border-red-200')}>{w.active!==false?'نشط':'معطّل'}</span></td>
                    </tr>
                  );
                })}
                {workerSummary.length===0&&<tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </TblBox>
        </div>
      )}

    </div>
  );
};

export default Reports;
