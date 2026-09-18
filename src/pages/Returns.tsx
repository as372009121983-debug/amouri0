import { useState, useCallback, useMemo } from 'react';
import { RotateCcw, Plus, Trash2, Search, Printer, Package, X, Calendar } from 'lucide-react';
import { printInvoice } from '@/lib/printInvoice';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import ProductSearchSelect from '@/components/features/ProductSearchSelect';
import type { Customer, Supplier } from '@/types';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const today = () => new Date().toISOString().split('T')[0];
const INPUT = 'w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all';
const INPUT_SM = 'w-full bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 transition-all';
const BTN_PRIMARY = 'flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition-all duration-200 active:scale-95';
const BTN_SECONDARY = 'flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-sm font-medium transition-all duration-200';

interface ReturnItem { id: string; product_id?: string; product_name: string; quantity: number; unit_price: number; unit: string; }
let _id = 0;
const newReturnItem = (): ReturnItem => ({ id: String(++_id), product_name: '', quantity: 1, unit_price: 0, unit: '' });

const Returns = () => {
  const { interact } = useInteraction();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [form, setForm] = useState({ type: 'مبيعات' as 'مبيعات' | 'مشتريات', customer_id: '', supplier_id: '', customer_name: '', supplier_name: '', reason: '', return_date: today() });

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['returns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('returns').select('*, return_items(*)').order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    staleTime: 30000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => { const { data } = await supabase.from('customers').select('id,name').order('name'); return (data || []) as Pick<Customer, 'id' | 'name'>[]; },
    staleTime: 60000,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => { const { data } = await supabase.from('suppliers').select('id,name').order('name'); return (data || []) as Pick<Supplier, 'id' | 'name'>[]; },
    staleTime: 60000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,price,unit', { column: 'name' }),
    staleTime: 60000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const total = returnItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const payload: any = {
        type: form.type, total_amount: total,
        reason: form.reason, return_date: form.return_date, status: 'مقبولة',
      };
      if (form.type === 'مبيعات') {
        payload.customer_id = form.customer_id || null;
        payload.customer_name = customers.find(c => c.id === form.customer_id)?.name || form.customer_name || '';
      } else {
        payload.supplier_id = form.supplier_id || null;
        payload.supplier_name = suppliers.find(s => s.id === form.supplier_id)?.name || form.supplier_name || '';
      }
      const { data: retData, error } = await supabase.from('returns').insert(payload).select('id').single();
      if (error) throw error;
      if (returnItems.length > 0) {
        const rows = returnItems.map(({ id: _id, ...it }) => ({ ...it, return_id: retData.id }));
        await supabase.from('return_items').insert(rows);
      }

      // ── Add returned items back to inventory ──
      if (form.type === 'مبيعات') {
        // Sales return → add back to warehouse inventory
        const { data: wh } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (wh) {
          for (const item of returnItems) {
            if (!item.product_id) continue;
            const { data: existing } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).eq('warehouse_id', wh.id).maybeSingle();
            if (existing) {
              await supabase.from('inventory').update({ quantity: existing.quantity + item.quantity, last_updated: new Date().toISOString() }).eq('id', existing.id);
            } else {
              await supabase.from('inventory').insert({ product_id: item.product_id, warehouse_id: wh.id, quantity: item.quantity });
            }
          }
        }
      }
      // Purchase return → items go back to supplier, deduct from our inventory
      // (deduction handled separately if needed)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      interact('success'); toast.success('تم تسجيل المرتجع وإضافة الكميات للمخزن'); setShowForm(false); setReturnItems([]);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ret: any) => {
      // Reverse inventory effect before deleting
      const items = (ret.return_items || []) as any[];
      if (ret.type === 'مبيعات') {
        // Sales return added to warehouse → remove it back
        for (const item of items) {
          if (!item.product_id) continue;
          const { data: invRows } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).order('quantity', { ascending: false });
          let rem = item.quantity;
          for (const inv of (invRows || [])) {
            if (rem <= 0) break;
            const deduct = Math.min(rem, inv.quantity);
            await supabase.from('inventory').update({ quantity: inv.quantity - deduct, last_updated: new Date().toISOString() }).eq('id', inv.id);
            rem -= deduct;
          }
        }
      }
      await supabase.from('returns').delete().eq('id', ret.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['returns'] });
      qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      interact('delete');
      toast.success('تم حذف المرتجع وعكس أثره على المخزون');
    },
  });

  const addItem = useCallback(() => setReturnItems(prev => [...prev, newReturnItem()]), []);
  const updateItem = useCallback((stableId: string, field: string, value: string | number) => {
    setReturnItems(prev => prev.map(item => {
      if (item.id !== stableId) return item;
      const updated = { ...item, [field]: value };
      if (field === 'product_id') {
        const p = products.find((p: any) => p.id === value);
        if (p) { updated.product_name = p.name; updated.unit_price = p.price || 0; updated.unit = p.unit || ''; }
      }
      return updated;
    }));
  }, [products]);
  const removeItem = useCallback((stableId: string) => setReturnItems(prev => prev.filter(i => i.id !== stableId)), []);

  const getDateRange = () => {
    const d = new Date(); const fmt = (dt: Date) => dt.toISOString().split('T')[0];
    if (dateFilter === 'اليوم') return { from: fmt(d), to: fmt(d) };
    if (dateFilter === 'أمس') { const y = new Date(d); y.setDate(d.getDate()-1); return { from: fmt(y), to: fmt(y) }; }
    if (dateFilter === 'هذا الأسبوع') { const s = new Date(d); s.setDate(d.getDate()-6); return { from: fmt(s), to: fmt(d) }; }
    if (dateFilter === 'هذا الشهر') return { from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, to: fmt(d) };
    if (dateFilter === 'مخصص') return { from: dateFrom, to: dateTo };
    return { from: '', to: '' };
  };
  const { from: rangeFrom, to: rangeTo } = getDateRange();

  const filtered = useMemo(() => returns.filter(r => {
    const mS = (r.customer_name || r.supplier_name || '').includes(search) || r.type.includes(search);
    const mD = (!rangeFrom || r.return_date >= rangeFrom) && (!rangeTo || r.return_date <= rangeTo);
    return mS && mD;
  }), [returns, search, rangeFrom, rangeTo]);

  const openReturnPrint = (r: any) => {
    interact('click');
    const items = (r.return_items || []) as ReturnItem[];
    const invNum = r.id?.slice(-8).toUpperCase() || 'RET';
    printInvoice({
      type: 'return',
      invoiceDate: r.return_date,
      invoiceNumber: invNum,
      status: r.status || 'مقبولة',
      partyLabel: r.type === 'مبيعات' ? 'العميل' : 'المورد',
      partyName: r.customer_name || r.supplier_name || '—',
      items: items.map(it => ({
        name: it.product_name,
        quantity: it.quantity,
        unit: it.unit || '',
        unit_price: it.unit_price,
        total_price: it.quantity * it.unit_price,
      })),
      totalAmount: r.total_amount,
      paidAmount: r.total_amount,
      notes: r.reason || '',
    });
  };

  const handlePrint = (r: any) => openReturnPrint(r);
  const handleDownloadPDF = (r: any) => openReturnPrint(r);

  const totalAmount = returnItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);

  if (isLoading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 gradient-red rounded-xl animate-pulse" /></div>;

  return (
    <>
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي المرتجعات', val: returns.length, color: 'text-red-600', border: 'border-red-200 bg-red-50' },
          { label: 'مرتجعات مبيعات', val: returns.filter(r => r.type === 'مبيعات').length, color: 'text-blue-600', border: 'border-blue-200 bg-blue-50' },
          { label: 'مرتجعات مشتريات', val: returns.filter(r => r.type === 'مشتريات').length, color: 'text-violet-600', border: 'border-violet-200 bg-violet-50' },
          { label: 'إجمالي المبالغ', val: EGP(returns.reduce((s, r) => s + r.total_amount, 0)), color: 'text-amber-600', border: 'border-amber-200 bg-amber-50' },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-4 border ${s.border}`}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.color} break-all`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Smart Date Filter */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {['الكل','اليوم','أمس','هذا الأسبوع','هذا الشهر','مخصص'].map(d => (
            <button key={d} onClick={() => { interact('click'); setDateFilter(d); }}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                dateFilter === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400')}>
              {d}
            </button>
          ))}
          {dateFilter === 'مخصص' && (
            <div className="flex gap-2 items-center flex-wrap">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs" />
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث..." value={search} onChange={e => setSearch(e.target.value)} className={cn(INPUT, 'pr-10')} />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-all"
          onClick={() => { interact('add'); setReturnItems([]); setForm({ type: 'مبيعات', customer_id: '', supplier_id: '', customer_name: '', supplier_name: '', reason: '', return_date: today() }); setShowForm(true); }}>
          <Plus className="w-4 h-4" /><span>مرتجع جديد</span>
        </button>
      </div>

      {/* Returns List */}
      <div className="space-y-3">
        {filtered.map((r, i) => {
          const items = (r.return_items || []) as any[];
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 ${r.type === 'مبيعات' ? 'bg-blue-500' : 'bg-violet-500'} rounded-xl flex items-center justify-center flex-shrink-0`}>
                    <RotateCcw className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-slate-800">{r.customer_name || r.supplier_name || 'غير محدد'}</p>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{r.type}</span>
                    </div>
                    <p className="text-xs text-slate-400">{r.return_date}{r.reason ? ` • ${r.reason}` : ''}</p>
                  </div>
                </div>
                <p className="font-bold text-red-600 text-sm">{EGP(r.total_amount)}</p>
              </div>
              {items.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {items.slice(0, 4).map((it: any, j: number) => (
                    <span key={j} className="text-xs font-medium bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded-md">{it.product_name} ×{it.quantity}</span>
                  ))}
                  {items.length > 4 && <span className="text-xs text-slate-400">+{items.length - 4}</span>}
                </div>
              )}
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => handlePrint(r)}
                  title="طباعة"
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors flex-shrink-0"
                >
                  <Printer className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                </button>
                <button
                  type="button"
                  onClick={() => { if (confirm('حذف المرتجع؟ سيتم عكس تأثيره على المخزون.')) deleteMutation.mutate(r); }}
                  title="حذف"
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl p-10 border border-slate-100 text-center">
            <RotateCcw className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">لا توجد مرتجعات</p>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-100 animate-fade-up my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center"><RotateCcw className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">تسجيل مرتجع جديد</h2>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Type */}
              <div className="flex gap-2">
                {(['مبيعات', 'مشتريات'] as const).map(t => (
                  <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                    className={cn('flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                      form.type === t ? (t === 'مبيعات' ? 'bg-blue-600 text-white border-blue-600' : 'bg-violet-600 text-white border-violet-600') : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                    مرتجع {t}
                  </button>
                ))}
              </div>

              {form.type === 'مبيعات' ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">العميل</label>
                  <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={INPUT}>
                    <option value="">اختر العميل</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">المورد</label>
                  <select value={form.supplier_id} onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))} className={INPUT}>
                    <option value="">اختر المورد</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-700">المنتجات المرتجعة</p>
                  <button className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-semibold" onClick={addItem}><Plus className="w-3 h-3" />إضافة</button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {returnItems.map(item => (
                    <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <ProductSearchSelect
                        products={products}
                        value={item.product_id || ''}
                        onChange={id => updateItem(item.id, 'product_id', id)}
                      />
                      <div className="grid grid-cols-12 gap-1.5 items-center">
                        <input type="number" placeholder="الكمية" value={item.quantity || ''} onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-4')} />
                        <input type="number" placeholder="السعر" value={item.unit_price || ''} onChange={e => updateItem(item.id, 'unit_price', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-5')} />
                        <div className="col-span-2 text-xs text-red-600 font-bold text-center">{item.quantity * item.unit_price > 0 ? EGP(item.quantity * item.unit_price) : '—'}</div>
                        <button className="col-span-1 flex items-center justify-center w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg" onClick={() => removeItem(item.id)}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                  {returnItems.length === 0 && (
                    <div className="text-center py-6 text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <Package className="w-6 h-6 mx-auto mb-1 opacity-30" />
                      <p className="text-xs">اضغط "إضافة" لإضافة منتجات</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">تاريخ المرتجع</label><input type="date" value={form.return_date} onChange={e => setForm(p => ({ ...p, return_date: e.target.value }))} className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">الإجمالي</label><div className="bg-red-50 border border-red-200 rounded-xl py-2.5 px-3 text-sm text-red-700 font-bold">{EGP(totalAmount)}</div></div>
              </div>
              <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">سبب الإرجاع</label><input type="text" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="وصف السبب..." className={INPUT} /></div>

              <div className="flex gap-3">
                <button className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 font-semibold transition-all" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>{addMutation.isPending ? 'جاري الحفظ...' : 'تسجيل المرتجع'}</button>
                <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => setShowForm(false)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default Returns;
