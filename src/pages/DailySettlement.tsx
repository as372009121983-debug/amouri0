import { useState, useMemo } from 'react';
import {
  CheckCircle, Wallet, Smartphone,
  TrendingUp, Hash, RefreshCw, ChevronDown, ChevronUp,
  Package, Calendar, Tag, Edit2, Save, Plus, Trash2, Lock,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';

const EGP = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م'; };
const today = () => new Date().toISOString().split('T')[0];
const INPUT = 'app-input';

const STATUS_COLORS: Record<string, string> = {
  'معلقة': 'bg-orange-50 text-orange-700 border-orange-200',
  'مؤجلة': 'bg-blue-50 text-blue-700 border-blue-200',
  'جزئي':  'bg-amber-50 text-amber-700 border-amber-200',
};

interface SettleEntry {
  paid: number;
  method: 'كاش' | 'محفظة';
  walletFrom: string;
  walletTo: string;
}

interface EditableItem {
  id: string;
  db_id?: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
}
let _tmpId = 0;
const newItem = (): EditableItem => ({ id: `tmp-${++_tmpId}`, product_name: '', quantity: 1, unit: '', unit_price: 0, total_price: 0 });

const DailySettlement = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canSettle = can(role, 'settlement:execute');

  const [selectedDate, setSelectedDate] = useState(today());
  const [entries, setEntries] = useState<Record<string, SettleEntry>>({});
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, { paid_amount: number; total_amount: number; discount: number; status: string }>>({});
  const [editItems, setEditItems] = useState<Record<string, EditableItem[]>>({});

  /* ── Queries ── */
  const { data: sales = [], isLoading, refetch } = useQuery({
    queryKey: ['settlement-sales', selectedDate],
    queryFn: async () => {
      // جلب فواتير اليوم المحدد + كل الفواتير الآجلة المترحّلة من أيام سابقة
      // الفواتير المعلقة لليوم الحالي + المؤجلة من أيام سابقة
      const { data, error } = await supabase
        .from('sales')
        .select('*, sale_items(id, product_name, quantity, unit, unit_price, total_price)')
        .in('status', ['معلقة', 'مؤجلة', 'جزئي', 'آجل'])
        .lte('sale_date', selectedDate)
        .order('sale_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers-settle'],
    queryFn: async () => {
      const { data } = await supabase.from('customers').select('id, name, balance');
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });

  /* ── Initialize entries when sales load ── */
  useMemo(() => {
    if (sales.length === 0) return;
    setEntries(prev => {
      const next = { ...prev };
      sales.forEach((s: any) => {
        if (!next[s.id]) {
          const remaining = s.total_amount - s.paid_amount;
          next[s.id] = { paid: remaining, method: 'كاش', walletFrom: '', walletTo: '' };
        }
      });
      return next;
    });
  }, [sales]);

  const updateEntry = (saleId: string, field: keyof SettleEntry, value: any) => {
    setEntries(prev => ({ ...prev, [saleId]: { ...prev[saleId], [field]: value } }));
  };

  const toggleExpand = (saleId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId); else next.add(saleId);
      return next;
    });
  };

  /* ── Editable Items Helpers ── */
  const addEditItem = (saleId: string) => {
    setEditItems(prev => ({ ...prev, [saleId]: [...(prev[saleId] || []), newItem()] }));
  };

  const updateEditItem = (saleId: string, itemId: string, field: keyof EditableItem, value: string | number) => {
    setEditItems(prev => {
      const updated = (prev[saleId] || []).map(it => {
        if (it.id !== itemId) return it;
        const u = { ...it, [field]: value };
        if (field === 'quantity' || field === 'unit_price') {
          u.total_price = (field === 'quantity' ? Number(value) : u.quantity) * (field === 'unit_price' ? Number(value) : u.unit_price);
        }
        return u;
      });
      // Recalculate total in editForm
      const itemsTotal = updated.reduce((s, it) => s + it.total_price, 0);
      setEditForm(prevF => ({
        ...prevF,
        [saleId]: { ...prevF[saleId], total_amount: itemsTotal },
      }));
      return { ...prev, [saleId]: updated };
    });
  };

  const removeEditItem = (saleId: string, itemId: string) => {
    setEditItems(prev => {
      const updated = (prev[saleId] || []).filter(it => it.id !== itemId);
      const itemsTotal = updated.reduce((s, it) => s + it.total_price, 0);
      setEditForm(prevF => ({
        ...prevF,
        [saleId]: { ...prevF[saleId], total_amount: itemsTotal },
      }));
      return { ...prev, [saleId]: updated };
    });
  };

  /* ── Edit Invoice Mutation (Full: header + items) ── */
  const editMutation = useMutation({
    mutationFn: async ({ saleId }: { saleId: string }) => {
      const ef = editForm[saleId];
      const items = editItems[saleId] || [];
      if (!ef) throw new Error('لا توجد بيانات تعديل');

      const itemsTotal = items.length > 0
        ? items.reduce((s, it) => s + it.total_price, 0)
        : ef.total_amount;
      const finalTotal = Math.max(0, itemsTotal - (ef.discount || 0));
      const autoStatus = ef.paid_amount >= finalTotal ? 'كاملة'
        : ef.paid_amount > 0 ? 'جزئي' : ef.status;

      // Update sale header
      const { error: saleErr } = await supabase.from('sales').update({
        paid_amount: ef.paid_amount,
        total_amount: finalTotal,
        discount: ef.discount || 0,
        status: autoStatus,
      }).eq('id', saleId);
      if (saleErr) throw saleErr;

      // Update items if provided
      if (items.length > 0) {
        await supabase.from('sale_items').delete().eq('sale_id', saleId);
        const rows = items.map(it => ({
          sale_id: saleId,
          product_id: null,
          product_name: it.product_name,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          total_price: it.total_price,
        }));
        const { error: itemsErr } = await supabase.from('sale_items').insert(rows);
        if (itemsErr) throw itemsErr;
      }
    },
    onSuccess: async () => {
      interact('success');
      toast.success('تم تحديث الفاتورة بالكامل');
      setEditingSale(null);
      await refetch();
      qc.invalidateQueries({ predicate: () => true });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const saveEdit = (saleId: string) => {
    editMutation.mutate({ saleId });
  };

  /* ── Settlement Mutation ── */
  const settleMutation = useMutation({
    mutationFn: async (saleIds: string[]) => {
      let totalSettled = 0;

      for (const saleId of saleIds) {
        const sale = sales.find((s: any) => s.id === saleId);
        if (!sale) continue;
        const entry = entries[saleId];
        if (!entry || entry.paid <= 0) continue;

        const remaining   = sale.total_amount - sale.paid_amount;
        const amountToPay = Math.min(entry.paid, remaining);
        if (amountToPay <= 0) continue;

        const newPaid   = sale.paid_amount + amountToPay;
        const newStatus = newPaid >= sale.total_amount ? 'كاملة'
          : newPaid > 0 ? 'جزئي' : 'معلقة';

        const { error: saleUpdateErr } = await supabase.from('sales').update({
          paid_amount:    newPaid,
          status:         newStatus,
          payment_method: entry.method,
          wallet_from:    entry.method === 'محفظة' ? entry.walletFrom : null,
          wallet_to:      entry.method === 'محفظة' ? entry.walletTo   : null,
        }).eq('id', saleId);
        if (saleUpdateErr) throw saleUpdateErr;

        if (sale.customer_id && amountToPay > 0) {
          const cust = customers.find((c: any) => c.id === sale.customer_id);
          if (cust) {
            await supabase.from('customers').update({
              balance: Math.max(0, (cust.balance || 0) - amountToPay),
            }).eq('id', sale.customer_id);
          }

          await supabase.from('customer_payments').insert({
            customer_id:    sale.customer_id,
            customer_name:  sale.customer_name,
            amount:         amountToPay,
            type:           'فاتورة معلقة تمت تسويتها',
            notes:          `فاتورة معلقة تمت تسويتها — ${selectedDate}`,
            payment_date:   today(),
            payment_method: entry.method,
            wallet_from:    entry.method === 'محفظة' ? entry.walletFrom : null,
            wallet_to:      entry.method === 'محفظة' ? entry.walletTo   : null,
            sale_id:        saleId,
          });
        }
        totalSettled += amountToPay;
      }
      return totalSettled;
    },
    onSuccess: async (totalSettled) => {
      interact('success');
      toast.success(`تمت التسوية — تم تحصيل ${EGP(totalSettled)}`);
      setEntries({});
      await refetch();
      qc.invalidateQueries({ predicate: () => true });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const settleAll = () => {
    const ids = sales.filter((s: any) => entries[s.id]?.paid > 0).map((s: any) => s.id);
    if (ids.length === 0) { toast.error('لا توجد مبالغ لتسويتها'); return; }
    if (!confirm(`تسوية ${ids.length} فاتورة؟`)) return;
    settleMutation.mutate(ids);
  };

  const settleOne = (saleId: string) => {
    if (!entries[saleId]?.paid || entries[saleId].paid <= 0) {
      toast.error('يرجى إدخال مبلغ أكبر من صفر');
      return;
    }
    settleMutation.mutate([saleId]);
  };

  const openEdit = (sale: any) => {
    setEditingSale(sale.id);
    setEditForm(prev => ({
      ...prev,
      [sale.id]: {
        paid_amount: sale.paid_amount,
        total_amount: sale.total_amount,
        discount: sale.discount || 0,
        status: sale.status,
      },
    }));
    const loadedItems: EditableItem[] = (sale.sale_items || []).map((it: any) => ({
      id: it.id || `tmp-${++_tmpId}`,
      db_id: it.id,
      product_name: it.product_name || '',
      quantity: it.quantity || 1,
      unit: it.unit || '',
      unit_price: it.unit_price || 0,
      total_price: it.total_price || 0,
    }));
    setEditItems(prev => ({ ...prev, [sale.id]: loadedItems }));
  };

  const totalPending     = sales.reduce((s: number, x: any) => s + (x.total_amount - x.paid_amount), 0);
  const totalWillCollect = Object.entries(entries)
    .filter(([id]) => sales.some((s: any) => s.id === id))
    .reduce((s, [, e]) => s + (e.paid || 0), 0);

  const quickDates = [
    { label: 'اليوم', date: today() },
    { label: 'أمس', date: (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; })() },
  ];

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  return (
    <div className="space-y-5">

      {/* ── Header Card ── */}
      <div className="rounded-2xl overflow-hidden shadow-md" style={{ background: 'linear-gradient(135deg,#c2410c,#ea580c)' }}>
        <div className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center border border-white/25">
                <CheckCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-white text-lg">تسوية مبيعات اليوم</h1>
                <p className="text-orange-100 text-xs">تحديث حالة الفواتير المعلقة والمؤجلة — مع تعديل كامل على الأصناف والأسعار</p>
              </div>
            </div>
            <button onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 border border-white/25 text-white text-xs font-semibold rounded-xl hover:bg-white/30 transition-all">
              <RefreshCw className="w-3.5 h-3.5" />تحديث
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <input type="date" value={selectedDate}
              onChange={e => { setSelectedDate(e.target.value); setEntries({}); setExpandedCards(new Set()); setEditingSale(null); }}
              className="border border-white/30 bg-white/15 text-white rounded-xl py-1.5 px-3 text-sm focus:outline-none focus:border-white/60" />
            {quickDates.map(b => (
              <button key={b.label} onClick={() => { setSelectedDate(b.date); setEntries({}); setExpandedCards(new Set()); setEditingSale(null); }}
                className={cn('px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                  selectedDate === b.date ? 'bg-white text-orange-700 border-white' : 'bg-white/10 text-white border-white/25 hover:bg-white/20')}>
                {b.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'إجمالي المعلق',  val: EGP(totalPending),      bg: 'bg-white/10 border-white/15' },
              { label: 'سيُحصَّل الآن',  val: EGP(totalWillCollect),  bg: 'bg-emerald-500/25 border-emerald-300/30' },
              { label: 'عدد الفواتير',   val: String(sales.length),   bg: 'bg-white/10 border-white/15' },
            ].map(k => (
              <div key={k.label} className={`rounded-xl p-3 border text-center ${k.bg}`}>
                <p className="text-xs text-white/60 font-medium">{k.label}</p>
                <p className="text-sm font-black text-white mt-0.5">{k.val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Empty State ── */}
      {sales.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-20 text-slate-400">
          <CheckCircle className="w-14 h-14 mb-4 text-emerald-400 opacity-50" />
          <p className="font-semibold text-slate-600 text-base">لا توجد فواتير معلقة أو مؤجلة</p>
          <p className="text-xs mt-1">جميع فواتير هذا اليوم تمت تسويتها</p>
        </div>
      )}

      {/* ── Sales Cards ── */}
      {sales.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold text-slate-600">{sales.length} فاتورة تنتظر التسوية</p>
            {canSettle ? (
              <button onClick={settleAll} disabled={settleMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-bold transition-all shadow-sm disabled:opacity-60">
                <CheckCircle className="w-4 h-4" />
                {settleMutation.isPending ? 'جاري...' : `تسوية الكل (${sales.length})`}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-400 rounded-xl text-sm font-bold cursor-not-allowed border border-slate-200">
                <Lock className="w-4 h-4" />لا تملك صلاحية التسوية
              </div>
            )}
          </div>

          <div className="space-y-4">
            {(sales as any[]).map((sale: any, idx: number) => {
              const entry = entries[sale.id] || { paid: sale.total_amount - sale.paid_amount, method: 'كاش' as const, walletFrom: '', walletTo: '' };
              const remaining  = sale.total_amount - sale.paid_amount;
              const items      = (sale.sale_items || []) as any[];
              const statusCls  = STATUS_COLORS[sale.status] || 'bg-slate-50 text-slate-600 border-slate-200';
              const isExpanded = expandedCards.has(sale.id);
              const isEditing  = editingSale === sale.id;
              const ef         = editForm[sale.id];
              const eitems     = editItems[sale.id] || [];

              // حساب الإجمالي في وضع التعديل
              const editItemsTotal = eitems.reduce((s, it) => s + it.total_price, 0);
              const editFinalTotal = ef ? Math.max(0, (eitems.length > 0 ? editItemsTotal : ef.total_amount) - (ef.discount || 0)) : 0;

              return (
                <div key={sale.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

                  {/* ── Card Header ── */}
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <span className="text-orange-700 font-black text-sm">{idx + 1}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-800 text-sm">{sale.customer_name || 'عميل نقدي'}</p>
                            <span className={cn('text-xs px-2 py-0.5 rounded-lg font-bold border', statusCls)}>{sale.status}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Calendar className="w-3 h-3" />{sale.sale_date}
                            </span>
                            {items.length > 0 && (
                              <span className="flex items-center gap-1 text-xs text-slate-400">
                                <Package className="w-3 h-3" />{items.length} صنف
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-black text-orange-600">{EGP(remaining)}</p>
                          <p className="text-xs text-slate-400">متبقي</p>
                        </div>
                        <button
                          onClick={() => { if (isEditing) { setEditingSale(null); } else { openEdit(sale); } }}
                          className={cn('w-8 h-8 rounded-xl flex items-center justify-center border transition-all',
                            isEditing ? 'bg-orange-100 border-orange-300 text-orange-600' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}
                          title="تعديل الفاتورة">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleExpand(sale.id)}
                          className="w-8 h-8 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-all">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ── Edit Invoice Form (Full) ── */}
                  {isEditing && ef && (
                    <div className="px-4 pt-4 pb-4 bg-orange-50/60 border-b border-orange-200 space-y-4">
                      <p className="text-xs font-bold text-orange-700 flex items-center gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />تعديل شامل للفاتورة (الأصناف + الأسعار + المدفوع)
                      </p>

                      {/* أصناف الفاتورة */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-orange-700">أصناف الفاتورة</p>
                          <button type="button" onClick={() => addEditItem(sale.id)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-orange-100 hover:bg-orange-200 text-orange-700 border border-orange-200 rounded-lg text-xs font-semibold transition-all">
                            <Plus className="w-3 h-3" />إضافة صنف
                          </button>
                        </div>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {eitems.map(item => (
                            <div key={item.id} className="bg-white border border-orange-200 rounded-xl p-2.5 space-y-1.5">
                              <input type="text" placeholder="اسم الصنف"
                                value={item.product_name}
                                onChange={e => updateEditItem(sale.id, item.id, 'product_name', e.target.value)}
                                className="w-full bg-orange-50 border border-orange-200 rounded-lg py-1.5 px-2.5 text-xs focus:outline-none focus:border-orange-400"
                              />
                              <div className="grid grid-cols-12 gap-1.5 items-center">
                                <input type="number" placeholder="الكمية"
                                  value={item.quantity || ''}
                                  onChange={e => updateEditItem(sale.id, item.id, 'quantity', Number(e.target.value))}
                                  className="col-span-3 bg-orange-50 border border-orange-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none"
                                />
                                <input type="text" placeholder="الوحدة"
                                  value={item.unit}
                                  onChange={e => updateEditItem(sale.id, item.id, 'unit', e.target.value)}
                                  className="col-span-2 bg-orange-50 border border-orange-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none"
                                />
                                <input type="number" placeholder="السعر"
                                  value={item.unit_price || ''}
                                  onChange={e => updateEditItem(sale.id, item.id, 'unit_price', Number(e.target.value))}
                                  className="col-span-4 bg-orange-50 border border-orange-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none"
                                />
                                <span className="col-span-2 text-xs font-bold text-orange-700 text-center">
                                  {item.total_price > 0 ? EGP(item.total_price) : '—'}
                                </span>
                                <button type="button" onClick={() => removeEditItem(sale.id, item.id)}
                                  className="col-span-1 flex items-center justify-center w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {eitems.length === 0 && (
                            <div className="text-center py-4 text-slate-400 text-xs bg-white border border-dashed border-orange-200 rounded-xl">
                              اضغط "إضافة صنف" لتعديل أصناف الفاتورة
                            </div>
                          )}
                        </div>
                        {eitems.length > 0 && (
                          <div className="flex justify-between items-center mt-1.5 px-1">
                            <span className="text-xs text-orange-600">{eitems.length} صنف</span>
                            <span className="text-xs font-bold text-orange-700">إجمالي الأصناف: {EGP(editItemsTotal)}</span>
                          </div>
                        )}
                      </div>

                      {/* المدفوع والخصم */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-orange-700">المدفوع (ج.م)</label>
                          <input type="number" min={0}
                            value={ef.paid_amount || ''}
                            onChange={e => setEditForm(prev => ({ ...prev, [sale.id]: { ...prev[sale.id], paid_amount: Number(e.target.value) } }))}
                            className="bg-white border border-orange-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-orange-400"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-orange-700">الخصم (ج.م)</label>
                          <input type="number" min={0}
                            value={ef.discount || ''}
                            onChange={e => setEditForm(prev => ({ ...prev, [sale.id]: { ...prev[sale.id], discount: Number(e.target.value) } }))}
                            className="bg-white border border-orange-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-orange-400"
                          />
                        </div>
                      </div>

                      {/* ملخص التعديل */}
                      <div className="bg-white border border-orange-200 rounded-xl p-3 space-y-1 text-xs">
                        {eitems.length > 0 && (
                          <div className="flex justify-between text-slate-500">
                            <span>إجمالي الأصناف:</span>
                            <span className="font-bold">{EGP(editItemsTotal)}</span>
                          </div>
                        )}
                        {(ef.discount || 0) > 0 && (
                          <div className="flex justify-between text-amber-600">
                            <span>الخصم:</span>
                            <span className="font-bold">-{EGP(ef.discount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-orange-700 font-bold border-t border-orange-100 pt-1">
                          <span>الإجمالي النهائي:</span>
                          <span>{EGP(editFinalTotal)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>المتبقي بعد التعديل:</span>
                          <span className={cn('font-bold', Math.max(0, editFinalTotal - ef.paid_amount) > 0 ? 'text-red-600' : 'text-emerald-600')}>
                            {EGP(Math.max(0, editFinalTotal - ef.paid_amount))}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-0.5">
                          <span className="text-slate-500">الحالة بعد الحفظ:</span>
                          <span className={cn('font-bold px-2 py-0.5 rounded-lg text-xs',
                            ef.paid_amount >= editFinalTotal ? 'bg-emerald-100 text-emerald-700' : ef.paid_amount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700')}>
                            {ef.paid_amount >= editFinalTotal ? 'كاملة ✓' : ef.paid_amount > 0 ? 'جزئي' : sale.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(sale.id)} disabled={editMutation.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-60">
                          <Save className="w-3 h-3" />{editMutation.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات الكاملة'}
                        </button>
                        <button onClick={() => { setEditingSale(null); setEditItems(prev => { const n = {...prev}; delete n[sale.id]; return n; }); }}
                          className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-xs hover:bg-slate-50 transition-all">
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Expanded Invoice Details ── */}
                  {isExpanded && !isEditing && (
                    <div className="px-4 pt-3 pb-2 bg-blue-50/40 border-b border-blue-100">
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: 'الإجمالي',      val: EGP(sale.total_amount),  color: 'text-slate-700' },
                          { label: 'مدفوع مسبقاً',  val: EGP(sale.paid_amount),   color: 'text-emerald-600' },
                          { label: 'المتبقي',        val: EGP(remaining),          color: 'text-orange-600 font-black' },
                        ].map(s => (
                          <div key={s.label} className="bg-white rounded-xl p-2.5 border border-blue-100 text-center">
                            <p className="text-xs text-slate-400 mb-0.5">{s.label}</p>
                            <p className={cn('text-xs font-bold', s.color)}>{s.val}</p>
                          </div>
                        ))}
                      </div>

                      {items.length > 0 && (
                        <div className="rounded-xl overflow-hidden border border-blue-200 mb-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-blue-600 text-white">
                                <th className="px-3 py-1.5 text-right font-semibold">الصنف</th>
                                <th className="px-2 py-1.5 text-center font-semibold w-14">الكمية</th>
                                <th className="px-2 py-1.5 text-center font-semibold w-20">السعر</th>
                                <th className="px-2 py-1.5 text-center font-semibold w-20">الإجمالي</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it: any, j: number) => (
                                <tr key={j} className={j % 2 === 1 ? 'bg-blue-50/60' : 'bg-white'}>
                                  <td className="px-3 py-1.5 font-semibold text-slate-800">{it.product_name}</td>
                                  <td className="px-2 py-1.5 text-center text-slate-600">{it.quantity}{it.unit ? ' '+it.unit : ''}</td>
                                  <td className="px-2 py-1.5 text-center text-slate-600">{EGP(it.unit_price)}</td>
                                  <td className="px-2 py-1.5 text-center font-bold text-emerald-700">{EGP(it.total_price)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-700 text-white">
                                <td colSpan={3} className="px-3 py-1.5 font-bold text-xs">إجمالي {items.length} صنف</td>
                                <td className="px-2 py-1.5 text-center font-black">{EGP(sale.total_amount + (sale.discount || 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mb-1">
                        {sale.payment_method && (
                          <span className="flex items-center gap-1 text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                            {sale.payment_method === 'محفظة' ? <Smartphone className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                            {sale.payment_method}
                          </span>
                        )}
                        {(sale.discount || 0) > 0 && (
                          <span className="flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">
                            <Tag className="w-3 h-3" />خصم: {EGP(sale.discount)}
                          </span>
                        )}
                        {sale.notes && (
                          <span className="text-xs text-slate-500 italic">{sale.notes}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Settlement Form ── */}
                  <div className="p-4 space-y-3">
                    {!isExpanded && !isEditing && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {items.slice(0, 3).map((it: any, j: number) => (
                          <span key={j} className="text-xs bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-lg">
                            {it.product_name} ×{it.quantity}
                          </span>
                        ))}
                        {items.length > 3 && <span className="text-xs text-slate-400">+{items.length - 3}</span>}
                        <button onClick={() => toggleExpand(sale.id)} className="text-xs text-blue-600 underline mr-1">عرض الكل</button>
                      </div>
                    )}

                    {/* طريقة الدفع */}
                    <div className="flex gap-2">
                      {([
                        { value: 'كاش', icon: Wallet, label: 'كاش' },
                        { value: 'محفظة', icon: Smartphone, label: 'محفظة' },
                      ] as const).map(m => (
                        <button key={m.value} type="button"
                          onClick={() => updateEntry(sale.id, 'method', m.value)}
                          className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all',
                            entry.method === m.value
                              ? m.value === 'كاش' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                          <m.icon className="w-3 h-3" />{m.label}
                        </button>
                      ))}
                    </div>

                    {entry.method === 'محفظة' && (
                      <div className="grid grid-cols-2 gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-blue-700 flex items-center gap-1"><Hash className="w-2.5 h-2.5" />من رقم</label>
                          <input type="text" value={entry.walletFrom} onChange={e => updateEntry(sale.id, 'walletFrom', e.target.value)} placeholder="01XXXXXXXXX"
                            className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-blue-400" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-blue-700 flex items-center gap-1"><Hash className="w-2.5 h-2.5" />إلى رقم</label>
                          <input type="text" value={entry.walletTo} onChange={e => updateEntry(sale.id, 'walletTo', e.target.value)} placeholder="01XXXXXXXXX"
                            className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-blue-400" />
                        </div>
                      </div>
                    )}

                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-slate-600 mb-1 block">
                          المبلغ المحصَّل (ج.م)
                          <span className="text-slate-400 text-xs mr-1">— أقصى {EGP(remaining)}</span>
                        </label>
                        <input type="number" min={0} max={remaining}
                          value={entry.paid || ''}
                          onChange={e => updateEntry(sale.id, 'paid', Math.min(remaining, Math.max(0, Number(e.target.value))))}
                          className={INPUT} placeholder="0" />
                      </div>
                      <div className="flex flex-col gap-1 pb-0.5">
                        <button className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
                          onClick={() => updateEntry(sale.id, 'paid', remaining)}>الكامل</button>
                        <button className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 whitespace-nowrap"
                          onClick={() => updateEntry(sale.id, 'paid', 0)}>صفر</button>
                      </div>
                    </div>

                    {entry.paid > 0 && (
                      <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-500">بعد التسوية:</span>
                        <span className={cn('font-bold px-2 py-0.5 rounded-lg border text-xs',
                          entry.paid >= remaining ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                          {entry.paid >= remaining ? 'كاملة ✓' : 'جزئي'}
                        </span>
                        <span className="text-slate-400 mr-auto">باقي: {EGP(Math.max(0, remaining - (entry.paid || 0)))}</span>
                      </div>
                    )}

                    <button onClick={() => settleOne(sale.id)}
                      disabled={!canSettle || !entry.paid || entry.paid <= 0 || settleMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      {canSettle ? <CheckCircle className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {!canSettle ? 'لا تملك صلاحية التسوية' : settleMutation.isPending ? 'جاري...' : 'تسوية هذه الفاتورة'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default DailySettlement;
