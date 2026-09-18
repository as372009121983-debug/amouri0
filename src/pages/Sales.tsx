import { useState, useCallback, useMemo } from 'react';
import {
  ShoppingCart, Plus, Trash2, Search, Printer, Eye, Package,
  CreditCard, CheckCircle, Clock, X, Calendar, Edit2,
  Wallet, Smartphone, Hash, Lock, AlertCircle,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import type { Sale, SaleItem, Customer, Product } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';
import { printInvoice } from '@/lib/printInvoice';
import ProductSearchSelect from '@/components/features/ProductSearchSelect';

const EGP = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م'; };
const today = () => new Date().toISOString().split('T')[0];
const INPUT = 'app-input';
const INPUT_SM = 'w-full bg-white border border-slate-200 rounded-lg py-2.5 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#a97a1f] transition-all';
const BTN_PRIMARY = 'btn-primary';
const BTN_SECONDARY = 'btn-secondary';

/** حساب الحالة التلقائية — نقدي أو آجل فقط */
const calcAutoStatus = (total: number, paid: number) =>
  total > 0 && paid >= total ? 'نقدي' : 'آجل';

const resolveStatus = (total: number, paid: number, manualStatus?: string | null): string => {
  if (total > 0 && paid >= total) return 'نقدي';
  if (manualStatus === 'نقدي') return 'نقدي';
  if (manualStatus === 'آجل') return 'آجل';
  // توافق مع الحالات القديمة
  if (manualStatus === 'كاملة' || manualStatus === 'مكتملة') return 'نقدي';
  if (manualStatus === 'مؤجلة' || manualStatus === 'معلقة' || manualStatus === 'جزئي') return 'آجل';
  return calcAutoStatus(total, paid);
};

interface FormItem {
  id: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
  source: string;
  _orig_qty?: number; // الكمية الأصلية (للتعديل)
}
let _id = 0;
const newItem = (): FormItem => ({ id: String(++_id), product_name: '', quantity: 1, unit_price: 0, total_price: 0, unit: '', source: 'inventory' });

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  'نقدي':   { label: 'نقدي',  className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  'آجل':    { label: 'آجل',   className: 'text-blue-700 bg-blue-50 border-blue-200' },
  // توافق مع البيانات القديمة
  'كاملة':  { label: 'نقدي',  className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  'مكتملة': { label: 'نقدي',  className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  'جزئي':   { label: 'آجل',   className: 'text-blue-700 bg-blue-50 border-blue-200' },
  'معلقة':  { label: 'آجل',   className: 'text-blue-700 bg-blue-50 border-blue-200' },
  'مؤجلة':  { label: 'آجل',   className: 'text-blue-700 bg-blue-50 border-blue-200' },
};

const PAYMENT_METHODS = [
  { value: 'كاش',    label: 'كاش',             icon: Wallet },
  { value: 'محفظة', label: 'محفظة إلكترونية',  icon: Smartphone },
];

const Sales = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canCreate  = can(role, 'sales:create');
  const canEdit    = can(role, 'sales:edit');
  const canDelete  = can(role, 'sales:delete');
  const canPayment = can(role, 'sales:payment');

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('الكل');
  const [dateFilter, setDateFilter] = useState('اليوم');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editSale, setEditSale] = useState<Sale | null>(null);
  const [showDetail, setShowDetail] = useState<Sale | null>(null);
  const [showPayment, setShowPayment] = useState<Sale | null>(null);
  const [saleItems, setSaleItems] = useState<FormItem[]>([]);
  const [form, setForm] = useState({
    customer_id: '', customer_name: '', paid_amount: 0, discount: 0, extra_amount: 0,
    notes: '', sale_date: today(),
    manual_status: '' as string,
    payment_method: 'كاش' as 'كاش' | 'محفظة',
    wallet_from: '', wallet_to: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: 0, notes: '', payment_date: today(),
    payment_method: 'كاش' as 'كاش' | 'محفظة',
    wallet_from: '', wallet_to: '',
  });

  /* ── Queries ── */
  const { data: sales = [], isLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Sale[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => { const { data } = await supabase.from('customers').select('id,name,balance').order('name'); return (data || []) as any[]; },
    staleTime: 60000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,price,purchase_price,min_sale_price,max_sale_price,unit,sku', { column: 'name' }),
    staleTime: 60000,
  });

  const { data: inventoryTotals = {} } = useQuery<Record<string, number>>({
    queryKey: ['sales-inventory-totals'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('inventory', 'product_id, quantity');
      const totals: Record<string, number> = {};
      (data || []).forEach((r: any) => { totals[r.product_id] = (totals[r.product_id] || 0) + r.quantity; });
      return totals;
    },
    staleTime: 30000,
  });

  const { data: showrooms = [] } = useQuery({
    queryKey: ['showrooms-list'],
    queryFn: async () => { const { data } = await supabase.from('showrooms').select('id,name').order('name'); return (data || []) as any[]; },
    staleTime: 60000,
  });

  const { data: showroomInvTotals = {} } = useQuery<Record<string, Record<string, number>>>({
    queryKey: ['showroom-inv-totals'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('showroom_inventory', 'showroom_id, product_id, quantity');
      const totals: Record<string, Record<string, number>> = {};
      (data || []).forEach((r: any) => {
        if (!totals[r.showroom_id]) totals[r.showroom_id] = {};
        totals[r.showroom_id][r.product_id] = (totals[r.showroom_id][r.product_id] || 0) + r.quantity;
      });
      return totals;
    },
    staleTime: 30000,
  });

  /* ── Add Sale Mutation ── */
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!form.customer_id) throw new Error('يرجى اختيار العميل أولاً');
      if (saleItems.length === 0) throw new Error('يرجى إضافة صنف واحد على الأقل');

      for (const item of saleItems) {
        if (!item.product_id) continue;
        if (item.source === 'inventory') {
          const avail = inventoryTotals[item.product_id] || 0;
          if (item.quantity > avail) throw new Error(`"${item.product_name}" - المتاح: ${avail}، المطلوب: ${item.quantity}`);
        } else {
          const showroomAvail = showroomInvTotals[item.source]?.[item.product_id] || 0;
          if (item.quantity > showroomAvail) throw new Error(`"${item.product_name}" - المتاح في المعرض: ${showroomAvail}`);
        }
      }

      const itemsTotal = saleItems.reduce((s, i) => s + i.total_price, 0);
      const total = itemsTotal - form.discount + (form.extra_amount || 0);
      // السماح بالمدفوع أكبر من الإجمالي
      const cashPaidNow = Math.max(0, form.paid_amount);
      const finalStatus = cashPaidNow >= total ? 'نقدي' : resolveStatus(total, cashPaidNow, form.manual_status || null);
      const customerName = customers.find((c: any) => c.id === form.customer_id)?.name || 'عميل نقدي';

      const { data: saleData, error: saleErr } = await supabase.from('sales').insert({
        customer_id: form.customer_id || null,
        customer_name: customerName,
        total_amount: total,
        paid_amount: cashPaidNow,
        initial_paid_amount: cashPaidNow,
        discount: form.discount,
        extra_amount: form.extra_amount || 0,
        status: finalStatus,
        notes: form.notes,
        sale_date: form.sale_date,
        invoice_type: 'بيع',
        manual_status: form.manual_status || null,
        payment_method: form.payment_method,
        wallet_from: form.payment_method === 'محفظة' ? form.wallet_from : null,
        wallet_to: form.payment_method === 'محفظة' ? form.wallet_to : null,
      }).select('id,customer_id,customer_name,total_amount,paid_amount,invoice_type').single();
      if (saleErr) throw saleErr;

      if (saleItems.length > 0) {
        const rows = saleItems.map(({ id: _id, source: _src, _orig_qty: _o, ...it }) => ({ ...it, sale_id: saleData.id }));
        await supabase.from('sale_items').insert(rows);
      }

      // تحديث دين العميل فقط إذا المدفوع أقل من الإجمالي
      const debtAmount = total - cashPaidNow;
      if (debtAmount > 0 && saleData.customer_id) {
        const { data: cust } = await supabase.from('customers').select('balance').eq('id', saleData.customer_id).single();
        if (cust) await supabase.from('customers').update({ balance: (cust.balance || 0) + debtAmount }).eq('id', saleData.customer_id);
      }

      for (const item of saleItems) {
        if (!item.product_id) continue;
        if (item.source === 'inventory') {
          const { data: invRows } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).order('quantity', { ascending: false });
          let rem = item.quantity;
          for (const inv of (invRows || [])) {
            if (rem <= 0) break;
            const deduct = Math.min(rem, inv.quantity);
            await supabase.from('inventory').update({ quantity: inv.quantity - deduct, last_updated: new Date().toISOString() }).eq('id', inv.id);
            rem -= deduct;
          }
        } else {
          const { data: sr } = await supabase.from('showroom_inventory').select('id, quantity').eq('showroom_id', item.source).eq('product_id', item.product_id).maybeSingle();
          if (sr) await supabase.from('showroom_inventory').update({ quantity: Math.max(0, sr.quantity - item.quantity), last_updated: new Date().toISOString() }).eq('id', sr.id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['showroom-inv-totals'] });
      interact('success');
      toast.success('تم تسجيل الفاتورة');
      setShowForm(false);
      setSaleItems([]);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ── Payment Mutation — تحديث الفاتورة تلقائياً حتى تكتمل ── */
  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!showPayment) return;
      if (paymentForm.amount <= 0) throw new Error('يرجى إدخال مبلغ صحيح أكبر من صفر');

      const remaining = showPayment.total_amount - showPayment.paid_amount;

      if (showPayment.customer_id) {
        // تسجيل دفعة وتحديث رصيد العميل
        if (paymentForm.amount <= remaining) {
          // دفعة جزئية أو كاملة — خصم من رصيد العميل
          const { data: cust } = await supabase.from('customers').select('balance').eq('id', showPayment.customer_id).single();
          if (cust) {
            await supabase.from('customers').update({
              balance: Math.max(0, (cust.balance || 0) - paymentForm.amount),
            }).eq('id', showPayment.customer_id);
          }
        }
        await supabase.from('customer_payments').insert({
          customer_id:    showPayment.customer_id,
          customer_name:  showPayment.customer_name,
          amount:         paymentForm.amount,
          type:           'تسديد آجل',
          notes:          paymentForm.notes || 'سداد مديونية',
          payment_date:   paymentForm.payment_date,
          payment_method: paymentForm.payment_method,
          wallet_from:    paymentForm.payment_method === 'محفظة' ? paymentForm.wallet_from : null,
          wallet_to:      paymentForm.payment_method === 'محفظة' ? paymentForm.wallet_to   : null,
          sale_id:        showPayment.id,
        });
        // trigger سيحدث paid_amount و status تلقائياً
      } else {
        // بدون عميل — تحديث مباشر مع السماح بدفع زيادة
        const newPaid = showPayment.paid_amount + paymentForm.amount;
        const finalStatus = newPaid >= showPayment.total_amount ? 'نقدي' : 'آجل';
        await supabase.from('sales').update({ paid_amount: newPaid, status: finalStatus }).eq('id', showPayment.id);
      }
    },
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['daily-cpayments'] });
      qc.invalidateQueries({ queryKey: ['daily-sales'] });
      interact('success');
      toast.success('تم تسجيل الدفعة');
      setShowPayment(null);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ── Delete Sale Mutation — إعادة الكميات للمخزون ── */
  const deleteMutation = useMutation({
    mutationFn: async (sale: Sale) => {
      const items = ((sale as any).sale_items || []) as SaleItem[];
      for (const item of items) {
        if (!(item as any).product_id) continue;
        const { data: wh } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (wh) {
          const { data: existing } = await supabase.from('inventory').select('id, quantity').eq('product_id', (item as any).product_id).eq('warehouse_id', wh.id).maybeSingle();
          if (existing) {
            await supabase.from('inventory').update({ quantity: existing.quantity + item.quantity, last_updated: new Date().toISOString() }).eq('id', existing.id);
          } else {
            await supabase.from('inventory').insert({ product_id: (item as any).product_id, warehouse_id: wh.id, quantity: item.quantity });
          }
        }
      }
      const saleRemaining = sale.total_amount - sale.paid_amount;
      if (saleRemaining > 0 && sale.customer_id) {
        const { data: cust } = await supabase.from('customers').select('balance').eq('id', sale.customer_id).single();
        if (cust) await supabase.from('customers').update({ balance: Math.max(0, (cust.balance || 0) - saleRemaining) }).eq('id', sale.customer_id);
      }
      await supabase.from('sales').delete().eq('id', sale.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      interact('delete');
      toast.success('تم حذف الفاتورة وإعادة الكميات للمخزون');
    },
  });

  /* ── Update Sale Mutation — مع استعادة الكميات المحذوفة ── */
  const updateSaleMutation = useMutation({
    mutationFn: async () => {
      if (!editSale) return;
      if (!form.customer_id) throw new Error('يرجى اختيار العميل أولاً');

      const oldItems = ((editSale as any).sale_items || []) as any[];
      const itemsTotal = saleItems.reduce((s, i) => s + i.total_price, 0);
      const total = itemsTotal - form.discount + (form.extra_amount || 0);
      // السماح بالمدفوع أكبر من الإجمالي
      const paidClamped = Math.max(0, form.paid_amount);
      const newRemaining = Math.max(0, total - paidClamped);
      const finalStatus = paidClamped >= total ? 'نقدي' : resolveStatus(total, paidClamped, form.manual_status || null);
      const customerName = customers.find((c: any) => c.id === form.customer_id)?.name || editSale.customer_name || 'عميل نقدي';

      // 1) حذف أصناف الفاتورة القديمة وإعادة كمياتها للمخزون
      for (const oldItem of oldItems) {
        if (!oldItem.product_id) continue;
        const { data: wh } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (wh) {
          const { data: existing } = await supabase.from('inventory').select('id, quantity').eq('product_id', oldItem.product_id).eq('warehouse_id', wh.id).maybeSingle();
          if (existing) {
            await supabase.from('inventory').update({ quantity: existing.quantity + oldItem.quantity, last_updated: new Date().toISOString() }).eq('id', existing.id);
          } else {
            await supabase.from('inventory').insert({ product_id: oldItem.product_id, warehouse_id: wh.id, quantity: oldItem.quantity });
          }
        }
      }

      // 2) تحديث رأس الفاتورة
      const { error: saleErr } = await supabase.from('sales').update({
        customer_id: form.customer_id || null,
        customer_name: customerName,
        total_amount: total,
        paid_amount: paidClamped,
        initial_paid_amount: paidClamped,
        discount: form.discount,
        extra_amount: form.extra_amount || 0,
        status: finalStatus,
        notes: form.notes,
        sale_date: form.sale_date,
        invoice_type: (editSale as any).invoice_type || 'بيع',
        manual_status: form.manual_status || null,
        payment_method: form.payment_method,
        wallet_from: form.payment_method === 'محفظة' ? form.wallet_from : null,
        wallet_to: form.payment_method === 'محفظة' ? form.wallet_to : null,
      }).eq('id', editSale.id);
      if (saleErr) throw saleErr;

      // 3) حذف وإعادة إدراج الأصناف الجديدة
      await supabase.from('sale_items').delete().eq('sale_id', editSale.id);
      if (saleItems.length > 0) {
        const rows = saleItems.map(({ id: _id, source: _src, _orig_qty: _o, ...it }) => ({ ...it, sale_id: editSale.id }));
        await supabase.from('sale_items').insert(rows);
      }

      // 4) خصم الكميات الجديدة من المخزون
      for (const item of saleItems) {
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

      // 5) تحديث رصيد العميل
      if (editSale.customer_id) {
        const oldRemaining = Math.max(0, editSale.total_amount - editSale.paid_amount);
        const { data: cust } = await supabase.from('customers').select('balance').eq('id', editSale.customer_id).single();
        if (cust) {
          const newBalance = Math.max(0, (cust.balance || 0) - oldRemaining + newRemaining);
          await supabase.from('customers').update({ balance: newBalance }).eq('id', editSale.customer_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      interact('success');
      toast.success('تم تحديث الفاتورة');
      setShowForm(false);
      setEditSale(null);
      setSaleItems([]);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ── Item helpers ── */
  const addItem = useCallback(() => setSaleItems(prev => [...prev, newItem()]), []);
  const updateItem = useCallback((stableId: string, field: string, value: string | number) => {
    setSaleItems(prev => prev.map(item => {
      if (item.id !== stableId) return item;
      const updated = { ...item, [field]: value };
      if (field === 'product_id') {
        const p = products.find((p: any) => p.id === value);
        if (p) { updated.product_name = p.name; updated.unit_price = p.price; updated.unit = p.unit || ''; updated.total_price = updated.quantity * p.price; }
      }
      if (field === 'quantity' || field === 'unit_price') {
        updated.total_price = (field === 'quantity' ? Number(value) : updated.quantity) * (field === 'unit_price' ? Number(value) : updated.unit_price);
      }
      return updated;
    }));
  }, [products]);
  const removeItem = useCallback((stableId: string) => setSaleItems(prev => prev.filter(i => i.id !== stableId)), []);

  const openEditSale = (sale: Sale) => {
    interact('click');
    setEditSale(sale);
    const items = ((sale as any).sale_items || []) as any[];
    setSaleItems(items.map(it => ({
      id: String(++_id),
      product_id: it.product_id || '',
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total_price: it.total_price,
      unit: it.unit || '',
      source: 'inventory',
      _orig_qty: it.quantity,
    })));
    setForm({
      customer_id: sale.customer_id || '',
      customer_name: sale.customer_name || '',
      paid_amount: sale.paid_amount,
      discount: sale.discount || 0,
      extra_amount: (sale as any).extra_amount || 0,
      notes: (sale as any).notes || '',
      sale_date: sale.sale_date,
      manual_status: (sale as any).manual_status || '',
      payment_method: (sale as any).payment_method || 'كاش',
      wallet_from: (sale as any).wallet_from || '',
      wallet_to: (sale as any).wallet_to || '',
    });
    setShowForm(true);
  };

  /* ── Date filters ── */
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

  const filtered = useMemo(() => sales.filter(s => {
    const mS = (s.customer_name || '').includes(search) || s.sale_date.includes(search);
    const mSt = filterStatus === 'الكل' ||
      (filterStatus === 'نقدي' && ['نقدي','كاملة','مكتملة'].includes(s.status)) ||
      (filterStatus === 'آجل' && ['آجل','مؤجلة','معلقة','جزئي'].includes(s.status));
    const mD = (!rangeFrom || s.sale_date >= rangeFrom) && (!rangeTo || s.sale_date <= rangeTo);
    return mS && mSt && mD;
  }), [sales, search, filterStatus, rangeFrom, rangeTo]);

  const itemsTotal = saleItems.reduce((s, i) => s + i.total_price, 0);
  const totalAmount = itemsTotal - form.discount + (form.extra_amount || 0);
  const liveStatus = form.paid_amount >= totalAmount && totalAmount > 0 ? 'نقدي' : resolveStatus(totalAmount, form.paid_amount, form.manual_status || null);
  const overpaid = form.paid_amount > totalAmount && totalAmount > 0;
  const pendingSales = useMemo(() => sales.filter(s => ['آجل','مؤجلة','معلقة','جزئي'].includes(s.status) && s.sale_date === today()), [sales]);
  const deferredTotal = sales.filter(s => ['آجل','جزئي','معلقة','مؤجلة'].includes(s.status)).reduce((s, x) => s + (x.total_amount - x.paid_amount), 0);
  const deferredOldSales = sales.filter(s => (s.status === 'آجل' || s.status === 'مؤجلة' || s.status === 'جزئي') && s.sale_date < today());

  const openSalePrint = (sale: Sale) => {
    interact('click');
    const items = ((sale as any).sale_items || []) as SaleItem[];
    const invNum = sale.id?.slice(-8).toUpperCase() || 'INV';
    printInvoice({
      type: 'sale', invoiceDate: sale.sale_date, invoiceNumber: invNum, status: sale.status,
      partyName: sale.customer_name || 'عميل نقدي',
      items: items.map(it => ({
        name: it.product_name, quantity: it.quantity, unit: it.unit || '',
        unit_price: it.unit_price, total_price: it.total_price,
        purchase_price: products.find((p: any) => p.id === (it as any).product_id)?.purchase_price,
      })),
      totalAmount: sale.total_amount, paidAmount: sale.paid_amount, discount: sale.discount || 0, showProfit: true,
    });
  };

  const getPurchaseCost = (sale: Sale): number => {
    const items = ((sale as any).sale_items || []) as any[];
    return items.reduce((s: number, it: any) => {
      const prod = products.find((p: any) => p.id === it.product_id);
      return s + (prod?.purchase_price || 0) * it.quantity;
    }, 0);
  };

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  /* ── Payment method section ── */
  const PaymentMethodSection = ({
    method, onMethod, walletFrom, onWalletFrom, walletTo, onWalletTo
  }: {
    method: 'كاش' | 'محفظة';
    onMethod: (v: 'كاش' | 'محفظة') => void;
    walletFrom: string; onWalletFrom: (v: string) => void;
    walletTo: string; onWalletTo: (v: string) => void;
  }) => (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-600">طريقة الدفع *</label>
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

  return (
    <div className="space-y-5">

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي المبيعات', val: EGP(sales.filter(s => (s as any).invoice_type !== 'شراء').reduce((s, x) => s + x.total_amount, 0)), cls: 'border-emerald-100 bg-emerald-50/60', text: 'text-emerald-700' },
          { label: 'مبيعات اليوم',   val: EGP(sales.filter(s => s.sale_date === today() && (s as any).invoice_type !== 'شراء').reduce((s, x) => s + x.total_amount, 0)), cls: 'border-blue-100 bg-blue-50/60', text: 'text-blue-700' },
          { label: 'ديون العملاء',   val: EGP(deferredTotal), cls: 'border-amber-100 bg-amber-50/60', text: 'text-amber-700' },
          { label: 'فواتير اليوم',   val: sales.filter(s => s.sale_date === today()).length, cls: 'border-slate-100 bg-slate-50/60', text: 'text-slate-700' },
        ].map((s, i) => (
          <div key={i} className={`stat-card border ${s.cls}`}>
            <p className="text-xs text-slate-500 mb-1.5">{s.label}</p>
            <p className={`text-xl font-bold ${s.text} break-all`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Pending Settlement Alert */}
      {pendingSales.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0"><Clock className="w-4 h-4 text-white" /></div>
          <div className="flex-1">
            <p className="font-bold text-orange-700 text-sm">فواتير معلقة تنتظر التسوية</p>
            <p className="text-xs text-orange-600 mt-0.5">{pendingSales.length} فاتورة — إجمالي: <strong>{EGP(pendingSales.reduce((s, x) => s + x.total_amount, 0))}</strong></p>
          </div>
          <button className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded-lg font-semibold flex-shrink-0"
            onClick={() => { interact('nav'); window.location.href = '/daily-settlement'; }}>
            صفحة التسوية
          </button>
        </div>
      )}

      {/* Deferred Alert */}
      {deferredOldSales.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0"><Clock className="w-4 h-4 text-white" /></div>
          <div className="flex-1">
            <p className="font-bold text-amber-700 text-sm">فواتير آجلة مترحّلة من أيام سابقة</p>
            <p className="text-xs text-amber-600 mt-0.5">{deferredOldSales.length} فاتورة — إجمالي المتبقي: <strong>{EGP(deferredOldSales.reduce((s, x) => s + (x.total_amount - x.paid_amount), 0))}</strong></p>
          </div>
          <button className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg font-semibold flex-shrink-0" onClick={() => setFilterStatus('مؤجلة')}>عرض الكل</button>
        </div>
      )}

      {/* Date Filter */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {['الكل','اليوم','أمس','هذا الأسبوع','هذا الشهر','مخصص'].map(d => (
            <button key={d} onClick={() => { interact('click'); setDateFilter(d); }}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                dateFilter === d ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-gold-300')}
              style={dateFilter === d ? { background: 'linear-gradient(135deg,#a97a1f,#dfb246)' } : {}}>
              {d}
            </button>
          ))}
          {dateFilter === 'مخصص' && (
            <div className="flex gap-2 items-center flex-wrap">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs focus:outline-none" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-slate-200 rounded-xl py-1.5 px-2 text-xs focus:outline-none" />
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث بالعميل..." value={search} onChange={e => setSearch(e.target.value)} className={cn(INPUT, 'pr-10')} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {['الكل','نقدي','آجل'].map(s => (
            <button key={s} onClick={() => { interact('click'); setFilterStatus(s); }}
              className={cn('px-4 py-2.5 rounded-xl text-sm font-medium border transition-all',
                filterStatus === s ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-gold-300')}
              style={filterStatus === s ? { background: 'linear-gradient(135deg,#a97a1f,#dfb246)' } : {}}>
              {s}
            </button>
          ))}
        </div>
        {canCreate && (
          <button className={BTN_PRIMARY}
            onClick={() => {
              interact('add');
              setEditSale(null);
              setSaleItems([]);
              setForm({ customer_id: '', customer_name: '', paid_amount: 0, discount: 0, extra_amount: 0, notes: '', sale_date: today(), manual_status: '', payment_method: 'كاش', wallet_from: '', wallet_to: '' });
              setShowForm(true);
            }}>
            <Plus className="w-4 h-4" /><span>فاتورة جديدة</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="daily-table min-w-[620px]">
            <thead>
              <tr style={{ background: 'linear-gradient(135deg,#a97a1f 0%,#dfb246 100%)' }}>
                <th className="tbl-head">المنتج</th>
                <th className="tbl-head text-center">العدد</th>
                <th className="tbl-head">الطرف</th>
                <th className="tbl-head hidden lg:table-cell">التكلفة</th>
                <th className="tbl-head">الإجمالي</th>
                <th className="tbl-head hidden md:table-cell">الربح</th>
                <th className="tbl-head hidden sm:table-cell">الحالة</th>
                <th className="tbl-head text-center">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sale, i) => {
                const sItems = ((sale as any).sale_items || []) as SaleItem[];
                const cfg = STATUS_CONFIG[sale.status] || { label: sale.status, className: 'text-slate-600 bg-slate-100 border-slate-200' };
                const cost = getPurchaseCost(sale);
                const profit = cost > 0 ? sale.total_amount - cost : null;
                const overpaidAmt = sale.paid_amount - sale.total_amount;
                return (
                  <tr key={sale.id} className="tbl-row animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {sItems.slice(0, 3).map((it, j) => (
                          <span key={j} className="text-xs font-semibold text-slate-800" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'150px'}}>{it.product_name}</span>
                        ))}
                        {sItems.length > 3 && <span className="text-xs text-slate-400">+{sItems.length - 3} أخرى</span>}
                        {sItems.length === 0 && <span className="text-xs text-slate-400">{sale.sale_date}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-sm text-slate-700">
                        {sItems.reduce((s, it) => s + (it.quantity || 0), 0) > 0
                          ? sItems.reduce((s, it) => s + (it.quantity || 0), 0).toLocaleString('ar-EG')
                          : '—'}
                      </span>
                      {sItems.length > 0 && (
                        <p className="text-xs text-slate-400">{sItems.length} صنف</p>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{whiteSpace:'nowrap'}}>
                      <p className="font-bold text-sm text-slate-800" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'120px'}}>{sale.customer_name || 'نقدي'}</p>
                      <p className="text-xs text-slate-400">{sale.sale_date}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400 hidden lg:table-cell" style={{whiteSpace:'nowrap'}}>{cost > 0 ? EGP(cost) : '—'}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-sm text-emerald-600 whitespace-nowrap">{EGP(sale.total_amount)}</p>
                      {overpaidAmt > 0 ? (
                        <p className="text-xs text-blue-600 font-semibold whitespace-nowrap">دفع زيادة: +{EGP(overpaidAmt)}</p>
                      ) : sale.total_amount !== sale.paid_amount ? (
                        <p className="text-xs text-amber-600 whitespace-nowrap">متبقي: {EGP(sale.total_amount - sale.paid_amount)}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell" style={{whiteSpace:'nowrap'}}>
                      {profit !== null ? <span className={cn('font-bold text-sm', profit >= 0 ? 'text-emerald-600' : 'text-red-500')}>{EGP(profit)}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={cn('text-xs px-2 py-1 rounded-lg border font-medium', cfg.className)}>{cfg.label}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => setShowDetail(sale)} title="معاينة"
                          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors flex-shrink-0">
                          <Eye className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                        </button>
                        <button type="button" onClick={() => openSalePrint(sale)} title="طباعة"
                          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors flex-shrink-0">
                          <Printer className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                        </button>
                        {canEdit ? (
                          <button type="button" onClick={() => openEditSale(sale)} title="تعديل"
                            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors flex-shrink-0">
                            <Edit2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                          </button>
                        ) : (
                          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0"><Lock className="w-3.5 h-3.5" /></div>
                        )}
                        {/* دفعة — لكل الفواتير غير المكتملة */}
                        {canPayment && sale.paid_amount < sale.total_amount && (
                          <button type="button"
                            onClick={() => { setShowPayment(sale); setPaymentForm({ amount: sale.total_amount - sale.paid_amount, notes: '', payment_date: today(), payment_method: 'كاش', wallet_from: '', wallet_to: '' }); }}
                            title="تسجيل دفعة"
                            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors flex-shrink-0">
                            <CreditCard className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                          </button>
                        )}
                        {canDelete ? (
                          <button type="button"
                            onClick={() => { if (confirm(`حذف هذه الفاتورة؟\nسيتم إعادة جميع الكميات للمخزون تلقائياً.`)) deleteMutation.mutate(sale); }}
                            title="حذف"
                            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors flex-shrink-0">
                            <Trash2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                          </button>
                        ) : (
                          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0"><Lock className="w-3.5 h-3.5" /></div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ShoppingCart className="w-12 h-12 mb-3 opacity-25" />
              <p className="text-sm font-medium mb-1">لا توجد فواتير</p>
            </div>
          )}
        </div>
      </div>

      {/* ════════ NEW / EDIT SALE MODAL ════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-100 animate-fade-up my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><ShoppingCart className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">{editSale ? 'تعديل الفاتورة' : 'فاتورة جديدة'}</h2>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => { setShowForm(false); setEditSale(null); }}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">

              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">العميل <span className="text-red-500">*</span></label>
                  <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={cn(INPUT, !form.customer_id ? 'border-red-300' : '')}>
                    <option value="">— اختر العميل —</option>
                    {customers.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}{(c.balance||0)>0 ? ` (دين: ${EGP(c.balance)})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">تاريخ الفاتورة</label>
                  <input type="date" value={form.sale_date} onChange={e => setForm(p => ({ ...p, sale_date: e.target.value }))} className={INPUT} />
                </div>

                {/* الحالة */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">الحالة</label>
                  <div className="flex gap-2 items-center">
                    <div className={cn('flex items-center gap-2 border rounded-xl py-2.5 px-4 text-base font-bold flex-1',
                      liveStatus === 'نقدي' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                       'bg-blue-50 border-blue-200 text-blue-700')}>
                      {liveStatus === 'نقدي' ? <CheckCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                      {form.manual_status ? `يدوي: ${form.manual_status}` : `تلقائي: ${liveStatus}`}
                      {overpaid && <span className="text-blue-600 text-sm font-bold mr-2">↑ دفع زيادة {EGP(form.paid_amount - totalAmount)}</span>}
                    </div>
                    <select value={form.manual_status} onChange={e => setForm(p => ({ ...p, manual_status: e.target.value }))}
                      className="border border-slate-200 rounded-xl py-2.5 px-4 text-sm text-slate-600 focus:outline-none focus:border-gold-400 bg-white">
                      <option value="">تلقائي</option>
                      <option value="نقدي">نقدي</option>
                      <option value="آجل">آجل</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-700">أصناف الفاتورة</p>
                  <button className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-semibold" onClick={addItem}><Plus className="w-3 h-3" />إضافة صنف</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {saleItems.map(item => {
                    const prod = products.find((p: any) => p.id === item.product_id);
                    const avail = item.source === 'inventory' ? (inventoryTotals[item.product_id || ''] || 0) : (showroomInvTotals[item.source]?.[item.product_id || ''] || 0);
                    return (
                      <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <ProductSearchSelect
                            products={products}
                            value={item.product_id || ''}
                            onChange={id => updateItem(item.id, 'product_id', id)}
                            renderExtra={p => {
                              const inv = inventoryTotals[p.id] || 0;
                              return <span className={cn('text-xs font-bold', inv === 0 ? 'text-red-500' : inv < 10 ? 'text-amber-500' : 'text-emerald-500')}>{inv === 0 ? 'نافد' : `متاح: ${inv}`}</span>;
                            }}
                          />
                          <select value={item.source} onChange={e => setSaleItems(prev => prev.map(it => it.id === item.id ? { ...it, source: e.target.value } : it))} className={INPUT_SM}>
                            <option value="inventory">من المخزن ({inventoryTotals[item.product_id || ''] || 0})</option>
                            {showrooms.map((sr: any) => <option key={sr.id} value={sr.id}>من {sr.name} ({showroomInvTotals[sr.id]?.[item.product_id || ''] || 0})</option>)}
                          </select>
                        </div>
                        {item.product_id && avail === 0 && <p className="text-xs text-red-600 font-semibold px-1">⚠️ المخزون نافد</p>}
                        {item.product_id && item.quantity > avail && avail > 0 && <p className="text-xs text-amber-600 font-semibold px-1">⚠️ المتاح: {avail}</p>}
                        {prod && <p className="text-xs text-blue-600 px-1">نطاق: {prod.min_sale_price ? EGP(prod.min_sale_price) : '—'} — {prod.max_sale_price ? EGP(prod.max_sale_price) : '—'}</p>}
                        <div className="grid grid-cols-12 gap-1.5 items-center">
                          <input type="number" placeholder="الكمية" value={item.quantity || ''} onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-3')} />
                          <input type="number" placeholder="سعر البيع" value={item.unit_price || ''} onChange={e => updateItem(item.id, 'unit_price', Number(e.target.value))} className={cn(INPUT_SM, 'col-span-4')} />
                          <div className="col-span-4 text-xs text-emerald-600 font-bold text-center">{item.total_price > 0 ? EGP(item.total_price) : '—'}</div>
                          <button className="col-span-1 flex items-center justify-center w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg" onClick={() => removeItem(item.id)}><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    );
                  })}
                  {saleItems.length === 0 && (
                    <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">اضغط "إضافة صنف"</p>
                    </div>
                  )}
                </div>
              </div>

              {/* الأرقام */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">خصم (ج.م)</label>
                  <input type="number" value={form.discount || ''} onChange={e => setForm(p => ({ ...p, discount: Number(e.target.value) }))} className={INPUT} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">مبلغ إضافي (ج.م)</label>
                  <input type="number" value={form.extra_amount || ''} onChange={e => setForm(p => ({ ...p, extra_amount: Number(e.target.value) }))} className={INPUT} placeholder="توصيل، رسوم..." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">المدفوع (ج.م) — يُسمح بأكبر من الإجمالي</label>
                  <input type="number" value={form.paid_amount || ''} onChange={e => setForm(p => ({ ...p, paid_amount: Number(e.target.value) }))} className={INPUT} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-600">الإجمالي النهائي</label>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl py-3 px-4 text-base text-emerald-700 font-bold">{EGP(totalAmount)}</div>
                </div>
              </div>

              {/* إشعار دفع زيادة */}
              {overpaid && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-3">
                  <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <p className="text-xs text-blue-700 font-semibold">دفع زيادة: +{EGP(form.paid_amount - totalAmount)} — سيظهر على الفاتورة</p>
                </div>
              )}

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

              <input type="text" placeholder="ملاحظات..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={cn(INPUT, 'mb-5')} />

              <div className="flex gap-3">
                <button className={cn(BTN_PRIMARY, 'flex-1')}
                  onClick={() => editSale ? updateSaleMutation.mutate() : addMutation.mutate()}
                  disabled={addMutation.isPending || updateSaleMutation.isPending}>
                  {(addMutation.isPending || updateSaleMutation.isPending) ? 'جاري الحفظ...' : editSale ? 'حفظ التعديلات' : 'حفظ الفاتورة'}
                </button>
                <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => { setShowForm(false); setEditSale(null); }}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ PAYMENT MODAL ════════ */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center"><CreditCard className="w-4 h-4 text-amber-700" /></div>
                <div><h2 className="text-base font-bold text-slate-800">تسجيل دفعة</h2><p className="text-xs text-slate-400">{showPayment.customer_name}</p></div>
              </div>
              <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowPayment(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">الإجمالي:</span><span className="font-semibold">{EGP(showPayment.total_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">مدفوع:</span><span className="text-emerald-600 font-semibold">{EGP(showPayment.paid_amount)}</span></div>
                <div className="flex justify-between border-t border-amber-200 pt-1.5"><span className="text-amber-700 font-bold">المتبقي:</span><span className="text-amber-700 font-bold">{EGP(showPayment.total_amount - showPayment.paid_amount)}</span></div>
              </div>
              <div className="space-y-3">
                <PaymentMethodSection
                  method={paymentForm.payment_method}
                  onMethod={v => setPaymentForm(p => ({ ...p, payment_method: v }))}
                  walletFrom={paymentForm.wallet_from}
                  onWalletFrom={v => setPaymentForm(p => ({ ...p, wallet_from: v }))}
                  walletTo={paymentForm.wallet_to}
                  onWalletTo={v => setPaymentForm(p => ({ ...p, wallet_to: v }))}
                />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">مبلغ الدفعة * (يُسمح بأكبر من المتبقي)</label>
                  <input type="number" value={paymentForm.amount || ''} onChange={e => setPaymentForm(p => ({ ...p, amount: Number(e.target.value) }))} className={INPUT} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">تاريخ الدفعة</label>
                  <input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} className={INPUT} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">ملاحظات</label>
                  <input type="text" value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} className={INPUT} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button className={cn(BTN_PRIMARY, 'flex-1')}
                  onClick={() => { if (!paymentForm.amount) { toast.error('يرجى إدخال المبلغ'); return; } paymentMutation.mutate(); }}
                  disabled={paymentMutation.isPending}>
                  {paymentMutation.isPending ? 'جاري...' : 'تسجيل الدفعة'}
                </button>
                <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => setShowPayment(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ DETAIL MODAL ════════ */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-100 animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
              <h2 className="font-bold text-slate-800">تفاصيل الفاتورة</h2>
              <div className="flex items-center gap-2">
                <button className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gold-50 border border-gold-200 text-gold-700 rounded-xl text-xs font-semibold" onClick={() => openSalePrint(showDetail)}><Printer className="w-3.5 h-3.5" />طباعة</button>
                <button className="flex items-center justify-center w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl" onClick={() => setShowDetail(null)}><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  ['الطرف', showDetail.customer_name || 'نقدي'],
                  ['التاريخ', showDetail.sale_date],
                  ['الحالة', showDetail.status],
                  ['طريقة الدفع', (showDetail as any).payment_method || 'كاش'],
                  ...(((showDetail as any).extra_amount || 0) > 0 ? [['مبلغ إضافي', EGP((showDetail as any).extra_amount)]] : []),
                  ...(((showDetail as any).payment_method === 'محفظة' && (showDetail as any).wallet_from) ? [['من رقم', (showDetail as any).wallet_from]] : []),
                  ...(((showDetail as any).payment_method === 'محفظة' && (showDetail as any).wallet_to) ? [['إلى رقم', (showDetail as any).wallet_to]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-50 rounded-xl p-3"><p className="text-xs text-slate-400 mb-0.5">{k}</p><p className="font-semibold text-sm text-slate-800">{v}</p></div>
                ))}
              </div>
              {((showDetail as any).sale_items || []).length > 0 && (
                <div className="mb-4 space-y-2">
                  {((showDetail as any).sale_items as SaleItem[]).map((it, i) => {
                    const pp = products.find((p: any) => p.id === (it as any).product_id)?.purchase_price || 0;
                    const profit = pp > 0 ? (it.unit_price - pp) * it.quantity : null;
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                        <div><p className="text-sm font-bold text-blue-900">{it.product_name}</p><p className="text-xs text-blue-500">{it.quantity} × {EGP(it.unit_price)}{pp > 0 ? ` | شراء: ${EGP(pp)}` : ''}</p></div>
                        <div className="text-right">
                          <span className="text-emerald-600 font-bold text-sm">{EGP(it.total_price)}</span>
                          {profit !== null && <p className={cn('text-xs font-semibold', profit >= 0 ? 'text-emerald-500' : 'text-red-500')}>ربح: {EGP(profit)}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="space-y-2 text-sm border-t border-slate-100 pt-4">
                {(showDetail.discount || 0) > 0 && <div className="flex justify-between"><span className="text-slate-400">خصم:</span><span>- {EGP(showDetail.discount || 0)}</span></div>}
                {((showDetail as any).extra_amount || 0) > 0 && <div className="flex justify-between text-orange-600"><span>مبلغ إضافي:</span><span>+ {EGP((showDetail as any).extra_amount)}</span></div>}
                <div className="flex justify-between font-bold text-base"><span>الإجمالي:</span><span className="text-emerald-600">{EGP(showDetail.total_amount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المدفوع:</span><span className="text-emerald-600">{EGP(showDetail.paid_amount)}</span></div>
                {showDetail.paid_amount > showDetail.total_amount && (
                  <div className="flex justify-between text-blue-600 font-semibold"><span>دفع زيادة:</span><span>+{EGP(showDetail.paid_amount - showDetail.total_amount)}</span></div>
                )}
                {showDetail.total_amount > showDetail.paid_amount && <div className="flex justify-between text-amber-600 font-semibold"><span>المتبقي:</span><span>{EGP(showDetail.total_amount - showDetail.paid_amount)}</span></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sales;
