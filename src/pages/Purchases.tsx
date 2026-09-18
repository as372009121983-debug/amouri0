import { useState, useCallback, useMemo } from 'react';
import {
  ShoppingBag, Plus, Trash2, Search, Printer, Eye, Package,
  CreditCard, CheckCircle, Clock, X, Calendar, FileDown, ArrowUpCircle,
  Wallet, Smartphone, Hash, Edit2, Lock,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import ProductSearchSelect from '@/components/features/ProductSearchSelect';
import type { Purchase, PurchaseItem } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';
import { printInvoice } from '@/lib/printInvoice';

const EGP = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م'; };
const today = () => new Date().toISOString().split('T')[0];
const INPUT = 'w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all';
const INPUT_SM = 'w-full bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 transition-all';

const calcStatus = (total: number, paid: number) => total <= 0 ? 'مكتملة' : paid <= 0 ? 'آجل' : paid >= total ? 'مكتملة' : 'جزئي';
// تحديد الحالة مع السماح بالدفع الزائد

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  'مكتملة': { label: 'مكتملة', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'آجل':    { label: 'آجل',    bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  'جزئي':   { label: 'جزئي',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  'ملغاة':  { label: 'ملغاة',  bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
};

const PAYMENT_METHODS = [
  { value: 'كاش',    label: 'كاش',             icon: Wallet },
  { value: 'محفظة', label: 'محفظة إلكترونية',  icon: Smartphone },
];

interface FormItem { id: string; product_id?: string; product_name: string; quantity: number; unit_price: number; total_price: number; unit: string; }
let _id = 0;
const newItem = (): FormItem => ({ id: String(++_id), product_name: '', quantity: 1, unit_price: 0, total_price: 0, unit: '' });

const getMainWarehouseId = async (): Promise<string | null> => {
  const { data } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (data) return data.id;
  const { data: created } = await supabase.from('warehouses').insert({ name: 'المخزن الرئيسي', code: `WH-${Date.now()}`, type: 'رئيسي', status: 'نشط', capacity: 0, used: 0 }).select('id').single();
  return created?.id || null;
};

/* ── مكوّن طريقة الدفع المشترك ── */
const PaymentMethodSection = ({
  method, onMethod, walletFrom, onWalletFrom, walletTo, onWalletTo
}: {
  method: 'كاش' | 'محفظة';
  onMethod: (v: 'كاش' | 'محفظة') => void;
  walletFrom: string; onWalletFrom: (v: string) => void;
  walletTo: string; onWalletTo: (v: string) => void;
}) => (
  <div className="space-y-2">
    <label className="text-xs font-medium text-slate-600">طريقة الدفع *</label>
    <div className="flex gap-2">
      {PAYMENT_METHODS.map(m => {
        const Icon = m.icon;
        return (
          <button key={m.value} type="button"
            onClick={() => onMethod(m.value as 'كاش' | 'محفظة')}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border transition-all',
              method === m.value
                ? m.value === 'كاش' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
            <Icon className="w-3.5 h-3.5" />{m.label}
          </button>
        );
      })}
    </div>
    {method === 'محفظة' && (
      <div className="grid grid-cols-2 gap-2 mt-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-blue-700 flex items-center gap-1"><Hash className="w-3 h-3" />الرقم المحوَّل منه</label>
          <input type="text" value={walletFrom} onChange={e => onWalletFrom(e.target.value)}
            placeholder="01XXXXXXXXX" className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs text-slate-800 focus:outline-none focus:border-blue-400" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-blue-700 flex items-center gap-1"><Hash className="w-3 h-3" />الرقم المحوَّل إليه</label>
          <input type="text" value={walletTo} onChange={e => onWalletTo(e.target.value)}
            placeholder="01XXXXXXXXX" className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs text-slate-800 focus:outline-none focus:border-blue-400" />
        </div>
      </div>
    )}
  </div>
);

const Purchases = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canCreate  = can(role, 'purchases:create');
  const canEdit    = can(role, 'purchases:edit');
  const canDelete  = can(role, 'purchases:delete');
  const canPayment = can(role, 'purchases:payment');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('الكل');
  const [dateFilter, setDateFilter] = useState('اليوم');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<Purchase | null>(null);
  const [showEdit, setShowEdit] = useState<Purchase | null>(null);
  const [editForm, setEditForm] = useState({ supplier_id: '', supplier_name: '', paid_amount: 0, notes: '', purchase_date: today(), payment_method: 'كاش' as 'كاش' | 'محفظة', wallet_from: '', wallet_to: '' });
  const [editItems, setEditItems] = useState<FormItem[]>([]);
  const [showPayment, setShowPayment] = useState<Purchase | null>(null);
  const [purchaseItems, setPurchaseItems] = useState<FormItem[]>([]);
  const [form, setForm] = useState({
    supplier_id: '', supplier_name: '', paid_amount: 0, extra_amount: 0, notes: '', purchase_date: today(),
    payment_method: 'كاش' as 'كاش' | 'محفظة',
    wallet_from: '', wallet_to: '',
  });
  const [paymentForm, setPaymentForm] = useState({ amount: 0, notes: '', payment_date: today() });

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchases').select('*, purchase_items(*)').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Purchase[];
    },
    staleTime: 30000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => { const { data } = await supabase.from('suppliers').select('id,name,balance').order('name'); return (data || []) as any[]; },
    staleTime: 60000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,purchase_price,unit,sku', { column: 'name' }),
    staleTime: 60000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!form.supplier_id) throw new Error('يرجى اختيار المورد');
      const itemsTotal = purchaseItems.reduce((s, i) => s + i.total_price, 0);
      const total = itemsTotal + (form.extra_amount || 0);
      const cashPaidNow = Math.max(0, form.paid_amount);
      const autoStatus = cashPaidNow >= total && total > 0 ? 'مكتملة' : calcStatus(total, cashPaidNow);
      const remaining = Math.max(0, total - cashPaidNow);
      const { data: pData, error: pErr } = await supabase.from('purchases').insert({
        supplier_id: form.supplier_id || null,
        supplier_name: form.supplier_name || suppliers.find((s: any) => s.id === form.supplier_id)?.name || 'مورد غير محدد',
        total_amount: total, paid_amount: cashPaidNow, status: autoStatus, notes: form.notes, purchase_date: form.purchase_date,
        extra_amount: form.extra_amount || 0,
        payment_method: form.payment_method,
        wallet_from: form.payment_method === 'محفظة' ? form.wallet_from : null,
        wallet_to: form.payment_method === 'محفظة' ? form.wallet_to : null,
      }).select('id,supplier_id,supplier_name').single();
      if (pErr) throw pErr;
      if (purchaseItems.length > 0) {
        const rows = purchaseItems.map(({ id: _id, ...it }) => ({ ...it, purchase_id: pData.id }));
        await supabase.from('purchase_items').insert(rows);
      }
      if (remaining > 0 && pData.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', pData.supplier_id).single();
        if (sup) await supabase.from('suppliers').update({ balance: (sup.balance || 0) + remaining }).eq('id', pData.supplier_id);
      }
      const whId = await getMainWarehouseId();
      if (whId) {
        for (const item of purchaseItems) {
          if (!item.product_id) continue;
          const { data: existing } = await supabase.from('inventory').select('id,quantity').eq('product_id', item.product_id).eq('warehouse_id', whId).maybeSingle();
          if (existing) {
            await supabase.from('inventory').update({ quantity: existing.quantity + item.quantity, last_updated: new Date().toISOString() }).eq('id', existing.id);
          } else {
            await supabase.from('inventory').insert({ product_id: item.product_id, warehouse_id: whId, quantity: item.quantity });
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      interact('success'); toast.success('تم تسجيل أمر الشراء وإضافة المخزون');
      setShowForm(false); setPurchaseItems([]);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!showEdit) return;
      const total = editItems.reduce((s, i) => s + i.total_price, 0);
      const autoStatus = calcStatus(total, editForm.paid_amount);
      const oldRemaining = showEdit.total_amount - showEdit.paid_amount;
      const newRemaining = total - editForm.paid_amount;
      const { error } = await supabase.from('purchases').update({
        supplier_id: editForm.supplier_id || null,
        supplier_name: editForm.supplier_name || suppliers.find((s: any) => s.id === editForm.supplier_id)?.name || showEdit.supplier_name,
        total_amount: total,
        paid_amount: editForm.paid_amount,
        status: autoStatus,
        notes: editForm.notes,
        purchase_date: editForm.purchase_date,
        payment_method: editForm.payment_method,
        wallet_from: editForm.payment_method === 'محفظة' ? editForm.wallet_from : null,
        wallet_to: editForm.payment_method === 'محفظة' ? editForm.wallet_to : null,
      }).eq('id', showEdit.id);
      if (error) throw error;
      // تحديث أصناف الفاتورة
      await supabase.from('purchase_items').delete().eq('purchase_id', showEdit.id);
      if (editItems.length > 0) {
        const rows = editItems.map(({ id: _id, ...it }) => ({ ...it, purchase_id: showEdit.id }));
        await supabase.from('purchase_items').insert(rows);
      }
      // تحديث رصيد المورد
      if (showEdit.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', showEdit.supplier_id).single();
        if (sup) {
          const balanceChange = newRemaining - oldRemaining;
          await supabase.from('suppliers').update({ balance: Math.max(0, (sup.balance || 0) + balanceChange) }).eq('id', showEdit.supplier_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      interact('success'); toast.success('تم تحديث أمر الشراء');
      setShowEdit(null);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!showPayment) return;
      if (paymentForm.amount <= 0) throw new Error('يرجى إدخال مبلغ صحيح أكبر من صفر');
      const newPaid = showPayment.paid_amount + paymentForm.amount;
      const newStatus = newPaid >= showPayment.total_amount ? 'مكتملة' : newPaid > 0 ? 'جزئي' : 'آجل';
      await supabase.from('purchases').update({ paid_amount: newPaid, status: newStatus }).eq('id', showPayment.id);
      if (showPayment.supplier_id) {
        const prevRemaining = Math.max(0, showPayment.total_amount - showPayment.paid_amount);
        const deductAmt = Math.min(paymentForm.amount, prevRemaining);
        if (deductAmt > 0) {
          const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', showPayment.supplier_id).single();
          if (sup) await supabase.from('suppliers').update({ balance: Math.max(0, (sup.balance || 0) - deductAmt) }).eq('id', showPayment.supplier_id);
        }
        await supabase.from('supplier_payments').insert({ supplier_id: showPayment.supplier_id, supplier_name: showPayment.supplier_name, amount: paymentForm.amount, notes: paymentForm.notes || '', payment_date: paymentForm.payment_date });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); interact('success'); toast.success('تم تسجيل الدفعة'); setShowPayment(null); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (purchase: Purchase) => {
      const items = ((purchase as any).purchase_items || []) as PurchaseItem[];
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: invRows } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).order('quantity', { ascending: false });
        let remaining = item.quantity;
        for (const inv of (invRows || [])) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, inv.quantity);
          await supabase.from('inventory').update({ quantity: inv.quantity - deduct, last_updated: new Date().toISOString() }).eq('id', inv.id);
          remaining -= deduct;
        }
      }
      const purchaseRemaining = purchase.total_amount - purchase.paid_amount;
      if (purchaseRemaining > 0 && purchase.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', purchase.supplier_id).single();
        if (sup) await supabase.from('suppliers').update({ balance: Math.max(0, (sup.balance || 0) - purchaseRemaining) }).eq('id', purchase.supplier_id);
      }
      await supabase.from('purchases').delete().eq('id', purchase.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      interact('delete'); toast.success('تم حذف أمر الشراء وخصم الكميات من المخزون');
    },
  });

  const addEditItem = useCallback(() => setEditItems(prev => [...prev, newItem()]), []);
  const updateEditItem = useCallback((stableId: string, field: string, value: string | number) => {
    setEditItems(prev => prev.map(item => {
      if (item.id !== stableId) return item;
      const updated = { ...item, [field]: value };
      if (field === 'product_id') { const p = products.find((p: any) => p.id === value); if (p) { updated.product_name = p.name; updated.unit_price = p.purchase_price || 0; updated.unit = p.unit || ''; updated.total_price = updated.quantity * (p.purchase_price || 0); } }
      if (field === 'quantity' || field === 'unit_price') { updated.total_price = (field === 'quantity' ? Number(value) : updated.quantity) * (field === 'unit_price' ? Number(value) : updated.unit_price); }
      return updated;
    }));
  }, [products]);
  const removeEditItem = useCallback((stableId: string) => setEditItems(prev => prev.filter(i => i.id !== stableId)), []);

  const addItem = useCallback(() => setPurchaseItems(prev => [...prev, newItem()]), []);
  const updateItem = useCallback((stableId: string, field: string, value: string | number) => {
    setPurchaseItems(prev => prev.map(item => {
      if (item.id !== stableId) return item;
      const updated = { ...item, [field]: value };
      if (field === 'product_id') { const p = products.find((p: any) => p.id === value); if (p) { updated.product_name = p.name; updated.unit_price = p.purchase_price || 0; updated.unit = p.unit || ''; updated.total_price = updated.quantity * (p.purchase_price || 0); } }
      if (field === 'quantity' || field === 'unit_price') { updated.total_price = (field === 'quantity' ? Number(value) : updated.quantity) * (field === 'unit_price' ? Number(value) : updated.unit_price); }
      return updated;
    }));
  }, [products]);
  const removeItem = useCallback((stableId: string) => setPurchaseItems(prev => prev.filter(i => i.id !== stableId)), []);

  const getDateRange = () => {
    const d = new Date();
    const fmt = (dt: Date) => dt.toISOString().split('T')[0];
    if (dateFilter === 'اليوم') return { from: fmt(d), to: fmt(d) };
    if (dateFilter === 'أمس') { const y = new Date(d); y.setDate(d.getDate()-1); return { from: fmt(y), to: fmt(y) }; }
    if (dateFilter === 'هذا الأسبوع') { const s = new Date(d); s.setDate(d.getDate()-6); return { from: fmt(s), to: fmt(d) }; }
    if (dateFilter === 'هذا الشهر') return { from: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, to: fmt(d) };
    if (dateFilter === 'مخصص') return { from: dateFrom, to: dateTo };
    return { from: '', to: '' };
  };

  const { from: rangeFrom, to: rangeTo } = getDateRange();
  const filtered = useMemo(() => purchases.filter(p => {
    const mS = (p.supplier_name || '').includes(search) || p.purchase_date.includes(search);
    const mSt = filterStatus === 'الكل' || p.status === filterStatus;
    const mD = (!rangeFrom || p.purchase_date >= rangeFrom) && (!rangeTo || p.purchase_date <= rangeTo);
    return mS && mSt && mD;
  }), [purchases, search, filterStatus, rangeFrom, rangeTo]);

  const itemsSubtotal = purchaseItems.reduce((s, i) => s + i.total_price, 0);
  const totalAmount = itemsSubtotal + (form.extra_amount || 0);
  const overpaidPurch = form.paid_amount > totalAmount && totalAmount > 0;
  const autoStatus = form.paid_amount >= totalAmount && totalAmount > 0 ? 'مكتملة' : calcStatus(totalAmount, form.paid_amount);
  const deferredTotal = purchases.filter(p => p.status === 'آجل' || p.status === 'جزئي').reduce((s, x) => s + (x.total_amount - x.paid_amount), 0);
  const deferredCount = purchases.filter(p => p.status === 'آجل' || p.status === 'جزئي').length;

  const handlePrint = (purchase: Purchase) => {
    interact('click');
    const items = ((purchase as any).purchase_items || []) as PurchaseItem[];
    const invNum = purchase.id?.slice(-8).toUpperCase() || 'INV';
    printInvoice({
      type: 'purchase',
      invoiceDate: purchase.purchase_date,
      invoiceNumber: invNum,
      status: purchase.status,
      partyName: purchase.supplier_name || 'مورد غير محدد',
      partyLabel: 'المورد',
      items: items.map(it => ({ name: it.product_name, quantity: it.quantity, unit: it.unit || '', unit_price: it.unit_price, total_price: it.total_price })),
      totalAmount: purchase.total_amount,
      paidAmount: purchase.paid_amount,
      showProfit: false,
    });
  };

  if (isLoading) return <div className="flex items-center justify-center py-20"><div className="w-10 h-10 bg-violet-600 rounded-xl animate-pulse" /></div>;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي المشتريات', val: EGP(purchases.reduce((s, x) => s + x.total_amount, 0)), border: 'border-violet-200', bg: 'bg-violet-50/60', text: 'text-violet-700' },
          { label: 'مشتريات اليوم', val: EGP(purchases.filter(p => p.purchase_date === today()).reduce((s, x) => s + x.total_amount, 0)), border: 'border-blue-200', bg: 'bg-blue-50/60', text: 'text-blue-700' },
          { label: 'ديون الموردين', val: EGP(deferredTotal), border: 'border-red-200', bg: 'bg-red-50/60', text: 'text-red-700' },
          { label: 'فواتير آجلة', val: deferredCount, border: 'border-amber-200', bg: 'bg-amber-50/60', text: 'text-amber-700' },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-4 border ${s.border} ${s.bg}`}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-lg font-bold ${s.text} break-all`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Deferred banner */}
      {deferredCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0"><ArrowUpCircle className="w-4 h-4 text-white" /></div>
          <div className="flex-1"><p className="font-bold text-amber-700 text-sm">{deferredCount} فاتورة شراء آجلة — إجمالي المتبقي: {EGP(deferredTotal)}</p></div>
          <button className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg font-semibold" onClick={() => setFilterStatus('آجل')}>عرض</button>
        </div>
      )}

      {/* Date Filter */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {['الكل','اليوم','أمس','هذا الأسبوع','هذا الشهر','مخصص'].map(d => (
            <button key={d} onClick={() => { interact('click'); setDateFilter(d); }}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                dateFilter === d ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600')}>
              {d}
            </button>
          ))}
          {dateFilter === 'مخصص' && (
            <div className="flex gap-2 items-center flex-wrap">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs text-slate-700 focus:outline-none" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs text-slate-700 focus:outline-none" />
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث بالمورد..." value={search} onChange={e => setSearch(e.target.value)} className={cn(INPUT, 'pr-10')} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {['الكل','مكتملة','آجل','جزئي','ملغاة'].map(s => (
            <button key={s} onClick={() => { interact('click'); setFilterStatus(s); }}
              className={cn('px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                filterStatus === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-300')}>
              {s}
            </button>
          ))}
        </div>
        {canCreate && (
          <button className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold transition-all"
            onClick={() => { interact('add'); setPurchaseItems([]); setForm({ supplier_id: '', supplier_name: '', paid_amount: 0, extra_amount: 0, notes: '', purchase_date: today(), payment_method: 'كاش', wallet_from: '', wallet_to: '' }); setShowForm(true); }}>
            <Plus className="w-4 h-4" /><span>أمر شراء جديد</span>
          </button>
        )}
      </div>

      {/* Cards List */}
      <div className="space-y-3">
        {filtered.map((purchase, i) => {
          const pItems = ((purchase as any).purchase_items || []) as PurchaseItem[];
          const cfg = STATUS_CONFIG[purchase.status] || STATUS_CONFIG['مكتملة'];
          const remaining = purchase.total_amount - purchase.paid_amount;
          const paidPct = purchase.total_amount > 0 ? Math.min(100, (purchase.paid_amount / purchase.total_amount) * 100) : 100;
          const pm = (purchase as any).payment_method || 'كاش';

          return (
            <div key={purchase.id}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-200 animate-fade-up overflow-hidden"
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center flex-shrink-0">
                      <ShoppingBag className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{purchase.supplier_name || 'مورد غير محدد'}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400">{purchase.purchase_date}</span>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-semibold border', cfg.bg, cfg.text, cfg.border)}>{cfg.label}</span>
                        <span className="text-xs text-slate-400">{pItems.length} صنف</span>
                        {/* طريقة الدفع */}
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-semibold border flex items-center gap-0.5',
                          pm === 'محفظة' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                          {pm === 'محفظة' ? <Smartphone className="w-2.5 h-2.5" /> : <Wallet className="w-2.5 h-2.5" />}{pm}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-start gap-2">
                    <div>
                      <p className="font-bold text-violet-700 text-base">{EGP(purchase.total_amount)}</p>
                      {remaining > 0 && <p className="text-xs text-red-500 font-semibold">باقي: {EGP(remaining)}</p>}
                      {remaining === 0 && <p className="text-xs text-emerald-600">✓ مسدّد</p>}
                    </div>
                    {/* أزرار الإجراءات المضمّنة */}
                    <div className="flex items-center gap-1">
                      {/* تعديل — مديرون فقط */}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => {
                            const pItems = ((purchase as any).purchase_items || []) as PurchaseItem[];
                            setShowEdit(purchase);
                            setEditForm({ supplier_id: purchase.supplier_id || '', supplier_name: purchase.supplier_name || '', paid_amount: purchase.paid_amount, notes: purchase.notes || '', purchase_date: purchase.purchase_date, payment_method: ((purchase as any).payment_method || 'كاش') as 'كاش' | 'محفظة', wallet_from: (purchase as any).wallet_from || '', wallet_to: (purchase as any).wallet_to || '' });
                            setEditItems(pItems.map(it => ({ id: String(++_id), product_id: it.product_id, product_name: it.product_name, quantity: it.quantity, unit_price: it.unit_price, total_price: it.total_price, unit: it.unit || '' })));
                          }}
                          title="تعديل"
                          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors flex-shrink-0"
                        >
                          <Edit2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                        </button>
                      ) : (
                        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="تعديل المشتريات للمديرين فقط"><Lock className="w-3.5 h-3.5" /></div>
                      )}
                      {/* عرض التفاصيل */}
                      <button
                        type="button"
                        onClick={() => setShowDetail(purchase)}
                        title="عرض التفاصيل"
                        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors flex-shrink-0"
                      >
                        <Eye className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                      </button>
                      {/* طباعة */}
                      <button
                        type="button"
                        onClick={() => handlePrint(purchase)}
                        title="طباعة"
                        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors flex-shrink-0"
                      >
                        <Printer className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                      </button>
                      {/* تسديد — مديرون فقط */}
                      {canPayment && (purchase.status === 'آجل' || purchase.status === 'جزئي') && (
                        <button
                          type="button"
                          onClick={() => { setShowPayment(purchase); setPaymentForm({ amount: purchase.total_amount - purchase.paid_amount, notes: '', payment_date: today() }); }}
                          title="تسديد دفعة"
                          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors flex-shrink-0"
                        >
                          <CreditCard className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                        </button>
                      )}
                      {/* حذف — مديرون فقط */}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => { if (confirm('حذف أمر الشراء؟ سيتم خصم الكميات من المخزون.')) deleteMutation.mutate(purchase); }}
                          title="حذف"
                          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                        </button>
                      ) : (
                        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="حذف المشتريات للمديرين فقط"><Lock className="w-3.5 h-3.5" /></div>
                      )}
                    </div>
                  </div>
                </div>

                {purchase.total_amount > 0 && purchase.paid_amount > 0 && purchase.paid_amount < purchase.total_amount && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>مدفوع: {EGP(purchase.paid_amount)}</span>
                      <span>{Math.round(paidPct)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1 mt-2">
                  {pItems.slice(0, 4).map((it, j) => (
                    <span key={j} className="text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded-md">{it.product_name} ×{it.quantity}</span>
                  ))}
                  {pItems.length > 4 && <span className="text-xs text-slate-400">+{pItems.length - 4} أخرى</span>}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-100">
            <ShoppingBag className="w-12 h-12 mb-3 opacity-25" />
            <p className="text-sm font-medium mb-1">لا توجد أوامر شراء</p>
          </div>
        )}
      </div>

      {/* ════════ EDIT PURCHASE MODAL ════════ */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-100 animate-fade-up my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center"><Edit2 className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">تعديل أمر الشراء</h2>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowEdit(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">المورد *</label>
                  <select value={editForm.supplier_id} onChange={e => setEditForm(p => ({ ...p, supplier_id: e.target.value, supplier_name: suppliers.find((s: any) => s.id === e.target.value)?.name || '' }))} className={INPUT}>
                    <option value="">— اختر المورد —</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">تاريخ الشراء</label>
                  <input type="date" value={editForm.purchase_date} onChange={e => setEditForm(p => ({ ...p, purchase_date: e.target.value }))} className={INPUT} />
                </div>
              </div>
              {/* الأصناف */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-700">أصناف الأمر</p>
                  <button className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-xl text-xs font-semibold" onClick={addEditItem}><Plus className="w-3 h-3" />إضافة صنف</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {editItems.map(item => (
                    <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <ProductSearchSelect
                        products={products}
                        value={item.product_id || ''}
                        onChange={id => updateEditItem(item.id, 'product_id', id)}
                      />
                      <div className="grid grid-cols-12 gap-1.5 items-center">
                        <input type="number" placeholder="الكمية" value={item.quantity || ''} onChange={e => updateEditItem(item.id, 'quantity', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-3')} />
                        <input type="number" placeholder="سعر الشراء" value={item.unit_price || ''} onChange={e => updateEditItem(item.id, 'unit_price', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-4')} />
                        <div className="col-span-4 text-xs text-amber-600 font-bold text-center">{item.total_price > 0 ? EGP(item.total_price) : '—'}</div>
                        <button className="col-span-1 flex items-center justify-center w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg" onClick={() => removeEditItem(item.id)}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                  {editItems.length === 0 && (
                    <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">اضغط "إضافة صنف"</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">المدفوع (ج.م)</label><input type="number" value={editForm.paid_amount || ''} onChange={e => setEditForm(p => ({ ...p, paid_amount: Number(e.target.value) }))} className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">الإجمالي</label><div className="bg-amber-50 border border-amber-200 rounded-xl py-2.5 px-3 text-sm text-amber-700 font-bold">{EGP(editItems.reduce((s,i)=>s+i.total_price,0))}</div></div>
              </div>
              <div className="mb-4">
                <PaymentMethodSection
                  method={editForm.payment_method}
                  onMethod={v => setEditForm(p => ({ ...p, payment_method: v }))}
                  walletFrom={editForm.wallet_from}
                  onWalletFrom={v => setEditForm(p => ({ ...p, wallet_from: v }))}
                  walletTo={editForm.wallet_to}
                  onWalletTo={v => setEditForm(p => ({ ...p, wallet_to: v }))}
                />
              </div>
              <input type="text" placeholder="ملاحظات..." value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className={cn(INPUT, 'mb-5')} />
              <div className="flex gap-3">
                <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-all" onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
                  {editMutation.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-sm font-medium transition-all" onClick={() => setShowEdit(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ NEW PURCHASE MODAL ════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-100 animate-fade-up my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-violet-600 rounded-xl flex items-center justify-center"><ShoppingBag className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">أمر شراء جديد</h2>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => { interact('click'); setShowForm(false); }}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">المورد *</label>
                  <select value={form.supplier_id} onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value, supplier_name: suppliers.find((s: any) => s.id === e.target.value)?.name || '' }))} className={INPUT}>
                    <option value="">— اختر المورد (إلزامي) —</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}{(s.balance||0)>0?` (دين: ${EGP(s.balance)})`:''}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">تاريخ الشراء</label>
                  <input type="date" value={form.purchase_date} onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} className={INPUT} />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">الحالة (تلقائية)</label>
                  <div className={cn('border rounded-xl py-2.5 px-3 text-sm font-semibold flex items-center gap-2',
                    autoStatus === 'مكتملة' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : autoStatus === 'آجل' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
                    {autoStatus === 'مكتملة' ? <CheckCircle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}{autoStatus}
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-700">أصناف الأمر</p>
                  <button className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-semibold" onClick={addItem}><Plus className="w-3 h-3" />إضافة صنف</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {purchaseItems.map(item => (
                    <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <ProductSearchSelect
                        products={products}
                        value={item.product_id || ''}
                        onChange={id => updateItem(item.id, 'product_id', id)}
                      />
                      <div className="grid grid-cols-12 gap-1.5 items-center">
                        <input type="number" placeholder="الكمية" value={item.quantity || ''} onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-3')} />
                        <input type="number" placeholder="سعر الشراء" value={item.unit_price || ''} onChange={e => updateItem(item.id, 'unit_price', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-4')} />
                        <div className="col-span-4 text-xs text-violet-600 font-bold text-center">{item.total_price > 0 ? EGP(item.total_price) : '—'}</div>
                        <button className="col-span-1 flex items-center justify-center w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg" onClick={() => removeItem(item.id)}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                  {purchaseItems.length === 0 && (
                    <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">اضغط "إضافة صنف"</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">مبلغ إضافي (ج.م)</label><input type="number" value={form.extra_amount || ''} onChange={e => setForm(p => ({ ...p, extra_amount: Number(e.target.value) }))} placeholder="رسوم، توصيل..." className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">المدفوع (ج.م) — يُسمح أكبر من الإجمالي</label><input type="number" value={form.paid_amount || ''} onChange={e => setForm(p => ({ ...p, paid_amount: Number(e.target.value) }))} className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">الإجمالي النهائي</label><div className="bg-violet-50 border border-violet-200 rounded-xl py-2.5 px-3 text-sm text-violet-700 font-bold">{EGP(totalAmount)}</div></div>
              </div>
              {overpaidPurch && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-3">
                  <span className="text-xs text-blue-700 font-semibold">دفع زيادة: +{EGP(form.paid_amount - totalAmount)} — سيظهر على الفاتورة</span>
                </div>
              )}

              {/* طريقة الدفع */}
              <div className="mb-4">
                <PaymentMethodSection
                  method={form.payment_method}
                  onMethod={v => setForm(p => ({ ...p, payment_method: v }))}
                  walletFrom={form.wallet_from}
                  onWalletFrom={v => setForm(p => ({ ...p, wallet_from: v }))}
                  walletTo={form.wallet_to}
                  onWalletTo={v => setForm(p => ({ ...p, wallet_to: v }))}
                />
              </div>

              {totalAmount > 0 && form.paid_amount < totalAmount && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-4 flex justify-between text-xs">
                  <span className="text-amber-700">المتبقي للمورد:</span>
                  <span className="font-bold text-red-600">{EGP(totalAmount - form.paid_amount)}</span>
                </div>
              )}
              <input type="text" placeholder="ملاحظات..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={cn(INPUT, 'mb-5')} />

              <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 mb-5">
                <p className="text-xs text-violet-700">✅ بعد حفظ أمر الشراء، سيتم إضافة الكميات تلقائياً للمخزون</p>
              </div>

              <div className="flex gap-3">
                <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold transition-all" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                  {addMutation.isPending ? 'جاري الحفظ...' : 'حفظ أمر الشراء'}
                </button>
                <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-sm font-medium transition-all" onClick={() => { interact('click'); setShowForm(false); }}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center"><CreditCard className="w-4 h-4 text-amber-700" /></div>
                <div><h2 className="text-base font-bold text-slate-800">تسديد للمورد</h2><p className="text-xs text-slate-400">{showPayment.supplier_name}</p></div>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowPayment(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">الإجمالي:</span><span className="font-semibold">{EGP(showPayment.total_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">مدفوع:</span><span className="text-emerald-600 font-semibold">{EGP(showPayment.paid_amount)}</span></div>
                <div className="flex justify-between border-t border-amber-200 pt-1.5"><span className="text-amber-700 font-bold">المتبقي:</span><span className="text-red-600 font-bold text-base">{EGP(showPayment.total_amount - showPayment.paid_amount)}</span></div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">مبلغ الدفعة *</label><input type="number" value={paymentForm.amount || ''} onChange={e => setPaymentForm(p => ({ ...p, amount: Number(e.target.value) }))} max={showPayment.total_amount - showPayment.paid_amount} className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">تاريخ الدفعة</label><input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} className={INPUT} /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">ملاحظات</label><input type="text" value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} className={INPUT} /></div>
              </div>
              <div className="flex gap-3 mt-5">
                <button className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl py-2.5 font-semibold" onClick={() => { if (!paymentForm.amount) { toast.error('يرجى إدخال المبلغ'); return; } paymentMutation.mutate(); }} disabled={paymentMutation.isPending}>{paymentMutation.isPending ? 'جاري...' : 'تسجيل الدفعة'}</button>
                <button className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5" onClick={() => setShowPayment(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-100 animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
              <h2 className="font-bold text-slate-800">تفاصيل أمر الشراء</h2>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold" onClick={() => handlePrint(showDetail)}><Printer className="w-3.5 h-3.5" />طباعة</button>
                <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowDetail(null)}><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  ['المورد', showDetail.supplier_name || '—'],
                  ['التاريخ', showDetail.purchase_date],
                  ['الحالة', showDetail.status],
                  ['طريقة الدفع', (showDetail as any).payment_method || 'كاش'],
                  ...(((showDetail as any).payment_method === 'محفظة' && (showDetail as any).wallet_from) ? [['من رقم', (showDetail as any).wallet_from]] : []),
                  ...(((showDetail as any).payment_method === 'محفظة' && (showDetail as any).wallet_to) ? [['إلى رقم', (showDetail as any).wallet_to]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-50 rounded-xl p-3"><p className="text-xs text-slate-400 mb-0.5">{k}</p><p className="font-semibold text-sm text-slate-800">{v}</p></div>
                ))}
              </div>
              {((showDetail as any).purchase_items || []).length > 0 && (
                <div className="mb-4 space-y-2">
                  {((showDetail as any).purchase_items as PurchaseItem[]).map((it, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
                      <div><p className="text-sm font-bold text-violet-900">{it.product_name}</p><p className="text-xs text-violet-500">{it.quantity} × {EGP(it.unit_price)}</p></div>
                      <span className="text-violet-600 font-bold text-sm">{EGP(it.total_price)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2 text-sm border-t border-slate-100 pt-4">
                <div className="flex justify-between font-bold text-base"><span>الإجمالي:</span><span className="text-violet-600">{EGP(showDetail.total_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المدفوع:</span><span className="text-emerald-600">{EGP(showDetail.paid_amount)}</span></div>
                {showDetail.total_amount > showDetail.paid_amount && <div className="flex justify-between text-red-600 font-bold border-t pt-2"><span>المتبقي:</span><span>{EGP(showDetail.total_amount - showDetail.paid_amount)}</span></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Purchases;
