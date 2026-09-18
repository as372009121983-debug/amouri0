import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BookOpen, Trash2, Printer, Edit2, Save, Plus, X as XIcon,
  TrendingUp, TrendingDown, Wallet, CreditCard,
  ArrowUpCircle, Clock, DollarSign,
  Building2, ChevronDown, ChevronUp, FileDown, Smartphone,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Expense } from '@/types';
import { cn } from '@/lib/utils';
import { printInvoice, buildDailySalesPrintHTML } from '@/lib/printInvoice';
import type { DailyTxnRow } from '@/lib/printInvoice';

const fmt  = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG', { minimumFractionDigits: 2 }); };
const EGP  = (v: unknown) => fmt(v) + ' ج.م';
const fmtQ = (v: unknown) => { const n = Number(v) || 0; return n.toLocaleString('ar-EG'); };
const toDateStr = (d: Date) => d.toISOString().split('T')[0];

/* ── Per-item sale row ── */
interface SaleDetailRow {
  key: string;
  time: string;
  productName: string;
  customerName: string;
  quantity: number;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  profit: number;
  profitKnown: boolean;
  totalSale: number;
  totalCost: number;
  isPaid: boolean;
  status: string;
}

const Daily = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [selectedDate, setSelectedDate]     = useState(toDateStr(new Date()));
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm]       = useState({ description: '', amount: 0, category: 'عام' });
  const [openingBalance, setOpeningBalance] = useState(0);
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingInput, setOpeningInput]     = useState('0');
  const [showDeferredDetail, setShowDeferredDetail] = useState(false);
  const [editingDailyInvoice, setEditingDailyInvoice] = useState<any | null>(null);
  const [dailyEditForm, setDailyEditForm] = useState<{ paid_amount: number; total_amount: number; discount: number; status: string; notes: string }>({ paid_amount: 0, total_amount: 0, discount: 0, status: 'كاملة', notes: '' });
  const [dailyEditItems, setDailyEditItems] = useState<Array<{ id: string; product_name: string; quantity: number; unit: string; unit_price: number; total_price: number }>>([]);
  let _dailyItemId = 0;

  const isReadOnly = profile?.role === 'boss';

  useEffect(() => {
    const stored = localStorage.getItem(`daily_opening_${selectedDate}`);
    setOpeningBalance(stored ? Number(stored) : 0);
    setOpeningInput(stored || '0');
  }, [selectedDate]);

  const saveOpening = () => {
    const val = Number(openingInput) || 0;
    setOpeningBalance(val);
    localStorage.setItem(`daily_opening_${selectedDate}`, String(val));
    setEditingOpening(false);
    toast.success('تم حفظ رصيد البداية');
  };

  /* ── Queries ── */
  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-daily'],
    queryFn: async () => {
      return fetchAllRows<{ id: string; name: string; purchase_price: number }>('products', 'id,name,purchase_price');
    },
    staleTime: 120_000,
  });

  const { data: deferredRollover = [] } = useQuery({
    queryKey: ['daily-deferred-rollover', selectedDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('id,customer_name,total_amount,paid_amount,status,sale_date,sale_items(product_name,quantity,unit,unit_price,total_price,product_id)')
        .in('status', ['آجل', 'جزئي', 'مؤجلة'])
        .lt('sale_date', selectedDate)
        .order('sale_date', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: daySales = [] } = useQuery({
    queryKey: ['daily-sales', selectedDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('id,customer_name,warehouse_name,total_amount,paid_amount,initial_paid_amount,discount,status,created_at,sale_date,sale_items(id,product_id,product_name,quantity,unit,unit_price,total_price)')
        .eq('sale_date', selectedDate)
        .order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: dayPurchases = [] } = useQuery({
    queryKey: ['daily-purchases', selectedDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('purchases')
        .select('id,supplier_name,total_amount,paid_amount,status,payment_method,created_at,purchase_date,purchase_items(product_name,quantity,unit,unit_price,total_price)')
        .eq('purchase_date', selectedDate)
        .order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: dayExpenses = [] } = useQuery({
    queryKey: ['daily-expenses', selectedDate],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('*').eq('expense_date', selectedDate).order('created_at', { ascending: true });
      return (data || []) as Expense[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  /* ── تحويل الفواتير المعلقة والآجلة القديمة إلى مؤجلة تلقائياً عند انتهاء اليوم ── */
  useEffect(() => {
    const convertOldPending = async () => {
      // تحويل معلقة وآجل من أيام سابقة إلى مؤجلة
      await supabase
        .from('sales')
        .update({ status: 'مؤجلة' })
        .in('status', ['معلقة', 'آجل'])
        .lt('sale_date', selectedDate);
    };
    convertOldPending();
  }, [selectedDate]);

  /* ── customer_payments مع بيانات الفاتورة المرتبطة لتحديد نوع الدفعة ── */
  const { data: dayCustomerPayments = [] } = useQuery({
    queryKey: ['daily-cpayments', selectedDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_payments')
        .select('*')
        .eq('payment_date', selectedDate)
        .order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: daySupplierPayments = [] } = useQuery({
    queryKey: ['daily-spayments', selectedDate],
    queryFn: async () => {
      const { data } = await supabase.from('supplier_payments').select('*').eq('payment_date', selectedDate).order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: dayWorkerTxns = [] } = useQuery({
    queryKey: ['daily-worker-txns', selectedDate],
    queryFn: async () => {
      const { data } = await supabase.from('worker_transactions').select('*').eq('transaction_date', selectedDate).order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: dayReturns = [] } = useQuery({
    queryKey: ['daily-returns', selectedDate],
    queryFn: async () => {
      const { data } = await supabase
        .from('returns')
        .select('id,type,customer_name,supplier_name,total_amount,created_at,return_date,return_items(product_name,quantity,unit_price)')
        .eq('return_date', selectedDate)
        .order('created_at', { ascending: true });
      return data || [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  /* ── Products lookup map ── */
  const productMap = useMemo(() => {
    const m: Record<string, number> = {};
    allProducts.forEach(p => { m[p.id] = p.purchase_price || 0; });
    return m;
  }, [allProducts]);

  /* ── Build per-item sale rows ── */
  const saleDetailRows = useMemo((): SaleDetailRow[] => {
    const rows: SaleDetailRow[] = [];
    (daySales as any[]).forEach((sale: any) => {
      const timeStr = sale.created_at
        ? new Date(sale.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        : '—';
      const isPaid = sale.status === 'مكتملة' || sale.status === 'كاملة';
      const items = (sale.sale_items || []) as any[];
      if (items.length === 0) {
        rows.push({
          key: `${sale.id}-0`,
          time: timeStr,
          productName: '—',
          customerName: sale.customer_name || 'نقدي',
          quantity: 0, unit: '', purchasePrice: 0, salePrice: 0,
          profit: 0, profitKnown: false, totalSale: sale.total_amount, totalCost: 0,
          isPaid, status: sale.status,
        });
      } else {
        items.forEach((it: any, idx: number) => {
          const bp = productMap[it.product_id] ?? 0;
          const sp = it.unit_price || 0;
          const qty = it.quantity || 0;
          const totalSale = it.total_price || sp * qty;
          const totalCost = bp * qty;
          const profit = bp > 0 ? totalSale - totalCost : 0;
          rows.push({
            key: `${sale.id}-${idx}`,
            time: idx === 0 ? timeStr : '',
            productName: it.product_name || '—',
            customerName: idx === 0 ? (sale.customer_name || 'نقدي') : '',
            quantity: qty,
            unit: it.unit || '',
            purchasePrice: bp,
            salePrice: sp,
            profit,
            profitKnown: bp > 0,
            totalSale,
            totalCost,
            isPaid,
            status: sale.status,
          });
        });
      }
    });
    return rows;
  }, [daySales, productMap]);

  /* ── IDs set for same-day sales ── */
  const daySaleIds = new Set((daySales as any[]).map((x: any) => x.id));

  /* ══════════════════════════════════════════════════════════════
     AGGREGATE TOTALS — معادلة محاسبية صحيحة
     
     قاعدة عدم التكرار:
     • كاش الإنشاء     = initial_paid_amount (أو fallback للفواتير القديمة)
     • السداد اللاحق   = customer_payments (سواء مرتبط بفاتورة اليوم أو لا)
     • كلاهما يُضافان للخزنة بشكل منفصل — لا خصم ولا تكرار
  ══════════════════════════════════════════════════════════════ */
  const totalSales = (daySales as any[]).reduce((s: number, x: any) => s + x.total_amount, 0);

  /*
   * totalCashSales: الكاش الأولي فقط لحظة إنشاء كل فاتورة
   * = initial_paid_amount إذا > 0
   * = paid_amount - مجموع customer_payments (للفواتير القديمة)
   */
  const totalCashSales = (daySales as any[]).reduce((s: number, x: any) => {
    const initPaid = Number(x.initial_paid_amount) || 0;
    if (initPaid > 0) return s + initPaid;
    // fallback للفواتير القديمة: paid_amount - customer_payments المرتبطة
    const cpForSale = (dayCustomerPayments as any[])
      .filter((cp: any) => cp.sale_id === x.id)
      .reduce((t: number, cp: any) => t + (cp.amount || 0), 0);
    return s + Math.max(0, (Number(x.paid_amount) || 0) - cpForSale);
  }, 0);

  const totalPurchases   = (dayPurchases as any[]).reduce((s: number, x: any) => s + x.total_amount, 0);
  const totalCashPurch   = (dayPurchases as any[]).filter((x: any) => (x.payment_method || 'كاش') !== 'محفظة').reduce((s: number, x: any) => s + (Number(x.paid_amount) || 0), 0);
  const totalWalletPurch = (dayPurchases as any[]).filter((x: any) => x.payment_method === 'محفظة').reduce((s: number, x: any) => s + (Number(x.paid_amount) || 0), 0);
  const totalExpenses    = dayExpenses.reduce((s, e) => s + e.amount, 0);

  /* كل تحصيلات العملاء — بما فيها المرتبطة بمبيعات اليوم */
  const totalCPay       = (dayCustomerPayments as any[]).reduce((s: number, x: any) => s + x.amount, 0);
  const totalCPayCash   = (dayCustomerPayments as any[]).filter((x: any) => (x.payment_method || 'كاش') !== 'محفظة').reduce((s: number, x: any) => s + x.amount, 0);
  const totalCPayWallet = (dayCustomerPayments as any[]).filter((x: any) => x.payment_method === 'محفظة').reduce((s: number, x: any) => s + x.amount, 0);

  /* الدفعات اللاحقة المرتبطة بمبيعات اليوم (تُعرض في جدول التحصيلات بتمييز) */
  const sameDaySalePayments = (dayCustomerPayments as any[]).filter((cp: any) => daySaleIds.has(cp.sale_id));
  const sameDayCPTotal = sameDaySalePayments.reduce((s: number, cp: any) => s + (cp.amount || 0), 0);

  /* تسويات الفواتير المعلقة (نوع مخصص) */
  const hiddenSettledPayments = (dayCustomerPayments as any[]).filter((p: any) =>
    p.type === 'فاتورة معلقة تمت تسويتها' && !daySaleIds.has(p.sale_id)
  );
  const hiddenFullSettlements: any[] = [];

  /*
   * visibleCPayments: كل الدفعات تظهر في الجدول السفلي
   * فقط نستثني تسويات الفواتير المعلقة (تظهر في بطاقة مستقلة)
   */
  const visibleCPayments = (dayCustomerPayments as any[]).filter((p: any) =>
    p.type !== 'فاتورة معلقة تمت تسويتها'
  );

  const totalSPay      = (daySupplierPayments as any[]).reduce((s: number, x: any) => s + x.amount, 0);
  const totalWorkerAdv = (dayWorkerTxns as any[]).filter((t: any) => t.type === 'سلفة').reduce((s: number, t: any) => s + t.amount, 0);
  const totalWorkerSal = (dayWorkerTxns as any[]).filter((t: any) => t.type === 'قبض').reduce((s: number, t: any) => s + t.amount, 0);
  const totalDeferred  = (deferredRollover as any[]).reduce((s: number, x: any) => s + (x.total_amount - x.paid_amount), 0);

  const totalProfit = saleDetailRows.reduce((s, r) => s + (r.profitKnown ? r.profit : 0), 0);
  const hasProfit   = saleDetailRows.some(r => r.profitKnown);

  /* المرتجعات */
  const purchaseReturns = (dayReturns as any[]).filter((r: any) => r.type === 'مشتريات').reduce((s: number, r: any) => s + (Number(r.total_amount) || 0), 0);
  const salesReturns    = (dayReturns as any[]).filter((r: any) => r.type === 'مبيعات').reduce((s: number, r: any) => s + (Number(r.total_amount) || 0), 0);

  /*
   * ══ معادلة الخزنة ══
   * الوارد = رصيد البداية
   *        + كاش إنشاء الفواتير (initial_paid_amount)
   *        + كل تحصيلات العملاء كاش (بما فيها مبيعات اليوم — لأنها مال دخل فعلاً)
   *        + مرتجعات مشتريات
   *
   * الصادر = مشتريات كاش + سداد موردين + مصروفات + سلف + مرتبات + مرتجعات مبيعات
   *
   * ملاحظة: totalCashSales لا يشمل customer_payments → لا تكرار
   */
  const totalMoneyIn  = openingBalance
    + totalCashSales          // كاش إنشاء الفواتير (initial_paid فقط)
    + totalCPayCash           // كل تحصيلات العملاء كاش (شاملة مبيعات اليوم)
    + purchaseReturns;

  const totalMoneyOut = totalCashPurch
    + totalSPay
    + totalExpenses
    + totalWorkerAdv
    + totalWorkerSal
    + salesReturns;

  const cashOnHand = totalMoneyIn - totalMoneyOut;

  /* ── Mutations ── */
  const openDailyEdit = useCallback((sale: any) => {
    setEditingDailyInvoice(sale);
    setDailyEditForm({
      paid_amount: sale.paid_amount || 0,
      total_amount: sale.total_amount || 0,
      discount: sale.discount || 0,
      status: sale.status || 'معلقة',
      notes: sale.notes || '',
    });
    const items = (sale.sale_items || []).map((it: any) => ({
      id: `ei-${++_dailyItemId}`,
      product_name: it.product_name || '',
      quantity: it.quantity || 1,
      unit: it.unit || '',
      unit_price: it.unit_price || 0,
      total_price: it.total_price || 0,
    }));
    setDailyEditItems(items);
  }, []);

  const saveDailyEditMutation = useMutation({
    mutationFn: async () => {
      if (!editingDailyInvoice) return;
      const itemsTotal = dailyEditItems.length > 0
        ? dailyEditItems.reduce((s, it) => s + it.total_price, 0)
        : dailyEditForm.total_amount;
      const finalTotal = Math.max(0, itemsTotal - (dailyEditForm.discount || 0));
      const autoStatus = dailyEditForm.paid_amount >= finalTotal ? 'كاملة'
        : dailyEditForm.paid_amount > 0 ? 'جزئي' : dailyEditForm.status;
      const { error: sErr } = await supabase.from('sales').update({
        paid_amount: dailyEditForm.paid_amount,
        total_amount: finalTotal,
        discount: dailyEditForm.discount,
        status: autoStatus,
        notes: dailyEditForm.notes,
      }).eq('id', editingDailyInvoice.id);
      if (sErr) throw sErr;
      if (dailyEditItems.length > 0) {
        await supabase.from('sale_items').delete().eq('sale_id', editingDailyInvoice.id);
        const rows = dailyEditItems.map(it => ({
          sale_id: editingDailyInvoice.id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          total_price: it.total_price,
        }));
        const { error: iErr } = await supabase.from('sale_items').insert(rows);
        if (iErr) throw iErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-sales', selectedDate] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      interact('success');
      toast.success('تم تحديث الفاتورة بنجاح');
      setEditingDailyInvoice(null);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const addDailyEditItem = () => {
    setDailyEditItems(prev => [...prev, { id: `ei-${++_dailyItemId}`, product_name: '', quantity: 1, unit: '', unit_price: 0, total_price: 0 }]);
  };
  const updateDailyEditItem = (id: string, field: string, value: string | number) => {
    setDailyEditItems(prev => prev.map(it => {
      if (it.id !== id) return it;
      const u = { ...it, [field]: value };
      if (field === 'quantity' || field === 'unit_price') {
        u.total_price = (field === 'quantity' ? Number(value) : u.quantity) * (field === 'unit_price' ? Number(value) : u.unit_price);
        const newItemsTotal = prev.map(x => x.id === id ? u : x).reduce((s, x) => s + x.total_price, 0);
        setDailyEditForm(f => ({ ...f, total_amount: newItemsTotal }));
      }
      return u;
    }));
  };
  const removeDailyEditItem = (id: string) => {
    setDailyEditItems(prev => {
      const updated = prev.filter(it => it.id !== id);
      const newTotal = updated.reduce((s, it) => s + it.total_price, 0);
      setDailyEditForm(f => ({ ...f, total_amount: newTotal }));
      return updated;
    });
  };

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('expenses').insert({ ...expenseForm, expense_date: selectedDate });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-expenses', selectedDate] });
      interact('success'); toast.success('تم إضافة المصروف');
      setShowExpenseForm(false); setExpenseForm({ description: '', amount: 0, category: 'عام' });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('expenses').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['daily-expenses', selectedDate] }); interact('delete'); },
  });

  const openLedgerPrint = () => {
    interact('click');

    // جميع فواتير اليوم تظهر في الطباعة — مع بيانات الكاش الأولي والدفعات اللاحقة
    const printRows = (daySales as any[]).flatMap((sale: any) => {
      const items = (sale.sale_items || []) as any[];
      const timeStr = sale.created_at
        ? new Date(sale.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        : '—';
      const initPaid = Number(sale.initial_paid_amount) || 0;
      const totalPaid = Number(sale.paid_amount) || 0;
      const laterCP = (dayCustomerPayments as any[]).filter((cp: any) => cp.sale_id === sale.id);
      const laterTotal = laterCP.reduce((s: number, cp: any) => s + (cp.amount || 0), 0);
      const displayInit = initPaid > 0 ? initPaid : Math.max(0, totalPaid - laterTotal);
      const isPaid = sale.status === 'كاملة' || sale.status === 'مكتملة';

      const baseRow = {
        purchasePrice: 0 as number | undefined,
        profitKnown: false,
        isPaid,
        status: sale.status,
        initialPaid: displayInit,
        laterCollections: laterTotal,
        totalPaid,
        totalAmount: sale.total_amount,
      };

      if (items.length === 0) {
        return [{
          ...baseRow,
          time: timeStr,
          productName: '—',
          customerName: sale.customer_name || 'نقدي',
          quantity: 0, unit: '',
          salePrice: 0,
        }];
      }

      return items.map((it: any, idx: number) => {
        const bp = productMap[it.product_id] ?? 0;
        return {
          ...baseRow,
          time: idx === 0 ? timeStr : '',
          productName: it.product_name || '—',
          customerName: idx === 0 ? (sale.customer_name || 'نقدي') : '',
          quantity: it.quantity || 0,
          unit: it.unit || '',
          salePrice: it.unit_price || 0,
          purchasePrice: bp || undefined,
          profitKnown: bp > 0,
          // المبلغ المدفوع يظهر فقط في أول صف من الفاتورة
          initialPaid: idx === 0 ? displayInit : undefined,
          laterCollections: idx === 0 ? laterTotal : undefined,
          totalPaid: idx === 0 ? totalPaid : undefined,
          totalAmount: idx === 0 ? sale.total_amount : undefined,
        };
      });
    });

    /* بناء قائمة المعاملات الأخرى */
    const txns: DailyTxnRow[] = [];
    (dayExpenses as any[]).forEach((e: any) => txns.push({ type: 'مصروف', detail: `${e.description} [${e.category}]`, amount: e.amount, isInflow: false }));
    (dayWorkerTxns as any[]).forEach((t: any) => txns.push({ type: t.type === 'سلفة' ? 'سلفة عامل' : 'مرتب عامل', detail: t.worker_name, amount: t.amount, isInflow: false }));
    (dayPurchases as any[]).forEach((p: any) => { if (p.paid_amount > 0) txns.push({ type: 'مشتريات', detail: p.supplier_name || 'مورد', amount: p.paid_amount, isInflow: false }); });
    (daySupplierPayments as any[]).forEach((p: any) => txns.push({ type: 'سداد مورد', detail: p.supplier_name || 'مورد', amount: p.amount, isInflow: false }));
    /* جميع تحصيلات العملاء تظهر في المعاملات */
    (dayCustomerPayments as any[]).forEach((p: any) => {
      const isSameDay = daySaleIds.has(p.sale_id);
      const label = isSameDay ? 'سداد لاحق نفس اليوم' : 'تحصيل آجل';
      txns.push({ type: label, detail: p.customer_name || 'عميل', amount: p.amount, isInflow: true });
    });
    (dayReturns as any[]).filter((r: any) => r.type === 'مشتريات').forEach((r: any) => txns.push({ type: 'مرتجع شراء', detail: r.supplier_name || 'مورد', amount: r.total_amount, isInflow: true }));
    (dayReturns as any[]).filter((r: any) => r.type === 'مبيعات').forEach((r: any) => txns.push({ type: 'مرتجع مبيعات', detail: r.customer_name || 'عميل', amount: r.total_amount, isInflow: false }));

    const html = buildDailySalesPrintHTML({
      dateStr:          selectedDate,
      rows:             printRows,
      totalSalesAmount: totalSales,
      totalInvoices:    (daySales as any[]).length,
      txns,
      openingBalance,
      totalMoneyIn,
      totalMoneyOut,
      cashOnHand,
      totalProfit,
      hasProfit,
      totalCashSales,
      totalLaterCollections: totalCPayCash,
    });

    const openPrint = (htmlStr: string) => {
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(htmlStr);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 600);
        return true;
      }
      return false;
    };

    if (!openPrint(html)) {
      try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 15_000);
      } catch { alert('تعذّر فتح صفحة الطباعة. يرجى السماح بالنوافذ المنبثقة.'); }
    }
  };

  const openInvoicePrint = (sale: any) => {
    interact('click');
    const invNum = sale.id?.slice(-8).toUpperCase() || 'INV';
    const items = (sale.sale_items || []) as any[];
    printInvoice({
      type: 'sale', invoiceDate: sale.sale_date, invoiceNumber: invNum, status: sale.status,
      partyName: sale.customer_name || 'عميل نقدي',
      items: items.map((it: any) => ({
        name: it.product_name, quantity: it.quantity, unit: it.unit || '',
        unit_price: it.unit_price, total_price: it.total_price,
        purchase_price: productMap[it.product_id],
      })),
      totalAmount: sale.total_amount, paidAmount: sale.paid_amount, discount: sale.discount || 0, showProfit: true,
    });
  };

  const handleExportCSV = () => {
    interact('success');
    const rows = ['الوقت,المنتج,العميل,العدد,سعر الشراء,سعر البيع,الربح,الحالة'];
    saleDetailRows.forEach(r => rows.push(`"${r.time}","${r.productName}","${r.customerName}",${r.quantity},${r.purchasePrice},${r.salePrice},${r.profitKnown ? r.profit : '—'},${r.status}`));
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `يومية-${selectedDate}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast.success('تم تصدير الملف');
  };

  const quickDates = [
    { label: 'اليوم', date: toDateStr(new Date()) },
    { label: 'أمس', date: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toDateStr(d); })() },
    { label: 'قبل يومين', date: (() => { const d = new Date(); d.setDate(d.getDate() - 2); return toDateStr(d); })() },
  ];

  /* ════════ RENDER ════════ */
  return (
    <div className="space-y-4 pb-6">

      {/* ── Top Bar ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gold-600">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-700 text-sm">اليومية</span>
          </div>
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-gold-400 bg-white" />
            <div className="flex gap-1 flex-wrap">
              {quickDates.map(b => (
                <button key={b.label} onClick={() => setSelectedDate(b.date)}
                  className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                    selectedDate === b.date ? 'bg-gold-600 text-white border-gold-600' : 'bg-white text-slate-500 border-slate-200 hover:border-gold-300')}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={openLedgerPrint} className="btn-secondary text-xs gap-1.5 py-2 px-3">
              <Printer className="w-3.5 h-3.5" /><span className="hidden sm:inline">طباعة</span>
            </button>
            <button onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-medium hover:bg-emerald-100 transition-all">
              <FileDown className="w-3.5 h-3.5" /><span className="hidden sm:inline">Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* ══════ HERO CASH CARD ══════ */}
      <div className="rounded-2xl overflow-hidden shadow-md" style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center border border-white/20">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-white/60 font-medium uppercase tracking-wide">الخزنة اليومية</p>
                <p className="text-xs text-white/50">{selectedDate}</p>
              </div>
            </div>
            {!isReadOnly && (
              <button onClick={() => setEditingOpening(!editingOpening)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border border-white/20 hover:bg-white/10 text-white/80">
                <Building2 className="w-3 h-3" />تعديل الرصيد
              </button>
            )}
          </div>

          <div className="text-center my-3">
            <p className="text-xs text-white/55 mb-1">فلوس الخزنة الآن</p>
            <p className={cn('text-4xl font-black', cashOnHand >= 0 ? 'text-white' : 'text-red-300')}>
              {EGP(cashOnHand)}
            </p>
          </div>

          {editingOpening && !isReadOnly && (
            <div className="bg-white/10 rounded-xl p-3 mb-3 flex items-center gap-2 border border-white/20">
              <span className="text-xs text-white/80 font-medium whitespace-nowrap">رصيد البداية:</span>
              <input type="number" value={openingInput} onChange={e => setOpeningInput(e.target.value)}
                autoFocus onKeyDown={e => e.key === 'Enter' && saveOpening()}
                className="flex-1 bg-white/20 border border-white/30 rounded-lg py-1.5 px-3 text-sm font-bold text-white focus:outline-none focus:border-white/60 min-w-0"
                placeholder="0" />
              <button onClick={saveOpening} className="px-3 py-1.5 bg-white text-gold-700 rounded-lg text-xs font-bold flex-shrink-0">حفظ</button>
              <button onClick={() => setEditingOpening(false)} className="px-3 py-1.5 bg-white/10 text-white/70 rounded-lg text-xs flex-shrink-0">إلغاء</button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="bg-white/10 rounded-xl p-3 border border-white/10 text-center">
              <p className="text-xs text-white/55 mb-1 font-medium">رصيد البداية</p>
              <p className="text-sm font-bold text-white/90">{EGP(openingBalance)}</p>
            </div>
            <div className="bg-emerald-500/20 rounded-xl p-3 border border-emerald-400/25 text-center">
              <p className="text-xs text-emerald-200 mb-1 font-medium">↓ إجمالي الوارد</p>
              <p className="text-sm font-black text-emerald-300">+{EGP(totalMoneyIn - openingBalance)}</p>
            </div>
            <div className="bg-red-500/20 rounded-xl p-3 border border-red-400/25 text-center">
              <p className="text-xs text-red-200 mb-1 font-medium">↑ إجمالي الصادر</p>
              <p className="text-sm font-black text-red-300">-{EGP(totalMoneyOut)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ══════ 6 KPI METRICS ══════ */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'المبيعات',   val: EGP(totalSales),     border: 'border-l-4 border-l-emerald-400', text: 'text-emerald-700', bg: 'bg-emerald-50/60',  Icon: TrendingUp },
          { label: 'المشتريات', val: EGP(totalPurchases),  border: 'border-l-4 border-l-violet-400',  text: 'text-violet-700',  bg: 'bg-violet-50/60',   Icon: TrendingDown },
          { label: 'المصروفات', val: EGP(totalExpenses),   border: 'border-l-4 border-l-red-400',     text: 'text-red-600',     bg: 'bg-red-50/60',       Icon: Wallet },
          { label: 'تحصيل آجل', val: EGP(totalCPay),       border: 'border-l-4 border-l-blue-400',   text: 'text-blue-700',    bg: 'bg-blue-50/60',     Icon: CreditCard },
          { label: 'دفع موردين',val: EGP(totalSPay),       border: 'border-l-4 border-l-amber-400',  text: 'text-amber-700',   bg: 'bg-amber-50/60',    Icon: ArrowUpCircle },
          { label: 'آجل مترحّل', val: EGP(totalDeferred),  border: 'border-l-4 border-l-orange-400', text: 'text-orange-700',  bg: 'bg-orange-50/60',   Icon: Clock },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-3 border border-slate-200 shadow-sm ${s.border} ${s.bg} bg-white`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <s.Icon className={`w-3.5 h-3.5 ${s.text} flex-shrink-0`} />
              <p className="text-xs text-slate-500 font-medium leading-tight truncate">{s.label}</p>
            </div>
            <p className={`text-xs font-black ${s.text} break-all leading-tight`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* ── Deferred Rollover ── */}
      {(deferredRollover as any[]).length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 hover:bg-amber-100 transition-all"
            onClick={() => setShowDeferredDetail(!showDeferredDetail)}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <span className="font-bold text-sm text-amber-800">فواتير آجلة مترحّلة</span>
              <span className="text-xs text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">{(deferredRollover as any[]).length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-red-600">{EGP(totalDeferred)}</span>
              {showDeferredDetail ? <ChevronUp className="w-4 h-4 text-amber-600" /> : <ChevronDown className="w-4 h-4 text-amber-600" />}
            </div>
          </button>
          {showDeferredDetail && (
            <div className="overflow-x-auto">
              <table className="daily-table min-w-[500px]">
                <thead>
                  <tr style={{ background: 'linear-gradient(135deg,#92400e,#b45309)' }}>
                    {['#', 'العميل', 'التاريخ', 'الحالة', 'الإجمالي', 'مدفوع', 'المتبقي', 'طباعة'].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(deferredRollover as any[]).map((sale: any, idx: number) => {
                    const remaining = sale.total_amount - sale.paid_amount;
                    return (
                      <tr key={sale.id}>
                        <td className="text-center text-slate-400 text-xs">{idx + 1}</td>
                        <td className="font-bold text-amber-800">{sale.customer_name || 'نقدي'}</td>
                        <td className="text-slate-500 text-xs whitespace-nowrap">{sale.sale_date}</td>
                        <td>
                          <span className={cn('text-xs px-2 py-0.5 rounded-lg font-bold border',
                            sale.status === 'آجل' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-100 text-amber-700 border-amber-300')}>
                            {sale.status}
                          </span>
                        </td>
                        <td className="font-bold text-slate-700 whitespace-nowrap text-center">{EGP(sale.total_amount)}</td>
                        <td className="font-bold text-emerald-600 whitespace-nowrap text-center">{EGP(sale.paid_amount)}</td>
                        <td className="font-bold text-red-600 whitespace-nowrap text-center">{EGP(remaining)}</td>
                        <td className="text-center">
                          <button onClick={() => openInvoicePrint(sale)}
                            className="w-7 h-7 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 flex items-center justify-center mx-auto transition-all">
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          MAIN DAILY SALES TABLE
      ══════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gold-50 border-b border-gold-100">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gold-600" />
            <span className="font-bold text-sm text-gold-800">مبيعات اليوم</span>
            <span className="text-xs text-gold-600 bg-gold-100 border border-gold-200 px-2 py-0.5 rounded-full font-semibold">
              {(daySales as any[]).length} فاتورة
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasProfit && (
              <span className="text-xs font-bold text-emerald-600">ربح: {EGP(totalProfit)}</span>
            )}
            <span className="font-bold text-sm text-gold-700">{EGP(totalSales)}</span>
          </div>
        </div>

        {saleDetailRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400">
            <TrendingUp className="w-10 h-10 mb-2 opacity-20" />
            <p className="text-sm">لا توجد مبيعات في هذا اليوم</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="daily-table min-w-[640px]">
              <thead>
                <tr style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
                  <th style={{width:'56px',whiteSpace:'nowrap'}}>الوقت</th>
                  <th style={{minWidth:'130px'}}>المنتج</th>
                  <th style={{minWidth:'90px',whiteSpace:'nowrap'}}>العميل</th>
                  <th className="text-center" style={{width:'62px',whiteSpace:'nowrap'}}>العدد</th>
                  <th className="text-center" style={{width:'96px',whiteSpace:'nowrap'}}>الإجمالي</th>
                  <th className="text-center" style={{width:'100px',whiteSpace:'nowrap'}}>المدفوع</th>
                  <th className="text-center" style={{width:'72px',whiteSpace:'nowrap'}}>الربح</th>
                  <th className="text-center" style={{width:'66px',whiteSpace:'nowrap'}}>الحالة</th>
                  <th className="text-center" style={{width:'44px'}}>طباعة</th>
                </tr>
              </thead>
              <tbody>
                {(daySales as any[]).map((sale: any) => {
                  const items = (sale.sale_items || []) as any[];
                  const rowSpan = items.length || 1;
                  const timeStr = sale.created_at
                    ? new Date(sale.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                    : '—';
                  const isPaid = sale.status === 'كاملة' || sale.status === 'مكتملة';
                  const saleRows = items.length > 0 ? items : [null];

                  return saleRows.map((it: any, idx: number) => {
                    const sp  = it ? it.unit_price || 0 : 0;
                    const qty = it ? it.quantity || 0 : 0;
                    const totalSaleAmt = it ? (it.total_price || sp * qty) : sale.total_amount;

                    return (
                      <tr key={`${sale.id}-${idx}`}
                        className={cn(
                          'border-b border-slate-100',
                          !isPaid ? 'bg-blue-50/30' : 'hover:bg-slate-50/60',
                          idx === 0 && saleRows.length > 1 ? 'border-t-2 border-t-gold-200' : '',
                        )}>
                        {idx === 0 ? (
                          <td rowSpan={rowSpan} className="whitespace-nowrap align-middle text-xs text-slate-500 font-semibold">
                            {timeStr}
                          </td>
                        ) : null}

                        <td className="font-semibold text-slate-800 text-sm" style={{whiteSpace:'nowrap',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis'}}>
                          {it ? it.product_name : '—'}
                        </td>

                        {idx === 0 ? (
                          <td rowSpan={rowSpan} className="font-bold text-gold-800 align-middle text-sm" style={{whiteSpace:'nowrap',maxWidth:'110px',overflow:'hidden',textOverflow:'ellipsis'}}>
                            {sale.customer_name || 'نقدي'}
                          </td>
                        ) : null}

                        <td className="text-center font-bold text-slate-700 text-sm">
                          {it ? `${fmtQ(qty)}${it.unit ? ' '+it.unit : ''}` : '—'}
                        </td>
                        <td className="text-center font-black text-emerald-700 whitespace-nowrap text-sm">
                          {totalSaleAmt > 0 ? EGP(totalSaleAmt) : '—'}
                        </td>

                        {/* عمود المدفوع: الكاش الأولي + إشارة للتحصيلات اللاحقة */}
                        {idx === 0 ? (
                          <td rowSpan={rowSpan} className="text-center align-middle whitespace-nowrap text-sm font-bold">
                            {(() => {
                              const initPaidRaw = Number(sale.initial_paid_amount) || 0;
                              const totalPaid   = Number(sale.paid_amount) || 0;
                              // تحصيلات لاحقة مرتبطة بهذه الفاتورة في نفس اليوم
                              const laterCollections = (dayCustomerPayments as any[]).filter(
                                (cp: any) => cp.sale_id === sale.id
                              );
                              const laterTotal = laterCollections.reduce((s: number, cp: any) => s + (cp.amount || 0), 0);
                              const isSettledViaSettlement = laterCollections.some(
                                (cp: any) => cp.type === 'فاتورة معلقة تمت تسويتها'
                              );
                              // الكاش الأولي لحظة الإنشاء فقط
                              const displayInitial = initPaidRaw > 0
                                ? initPaidRaw
                                : Math.max(0, totalPaid - laterTotal);
                              const remaining = Math.max(0, sale.total_amount - totalPaid);
                              return (
                                <>
                                  <span className={cn(
                                    displayInitial >= sale.total_amount ? 'text-emerald-600' :
                                    displayInitial > 0                  ? 'text-amber-600'   : 'text-red-500'
                                  )}>
                                    {EGP(Math.max(0, displayInitial))}
                                  </span>
                                  {laterTotal > 0 && isSettledViaSettlement && (
                                    <p className="text-xs text-orange-600 font-semibold mt-0.5">
                                      تسوية: +{EGP(laterTotal)}
                                    </p>
                                  )}
                                  {laterTotal > 0 && !isSettledViaSettlement && (
                                    <p className="text-xs text-blue-500 font-medium mt-0.5">
                                      +{EGP(laterTotal)} سداد لاحق
                                    </p>
                                  )}
                                  {remaining > 0 && (
                                    <p className="text-xs text-red-400 font-medium mt-0.5">باقي: {EGP(remaining)}</p>
                                  )}
                                  {displayInitial <= 0 && totalPaid <= 0 && (
                                    <p className="text-xs text-red-500 font-semibold mt-0.5">آجل كلي</p>
                                  )}
                                  {remaining === 0 && totalPaid > 0 && (
                                    <p className="text-xs text-emerald-500 font-semibold mt-0.5">✓ مسدَّد</p>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                        ) : null}

                        {(() => {
                          const bp = it ? (productMap[it.product_id] ?? 0) : 0;
                          const sp2 = it ? (it.unit_price || 0) : 0;
                          const qty2 = it ? (it.quantity || 0) : 0;
                          const rowProfit = bp > 0 ? (sp2 - bp) * qty2 : null;
                          return (
                            <td className="text-center whitespace-nowrap text-sm font-bold">
                              {rowProfit !== null
                                ? <span className={rowProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}>{EGP(rowProfit)}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })()}

                        {idx === 0 ? (
                          <td rowSpan={rowSpan} className="text-center align-middle">
                            {(() => {
                              const settledPayments = (dayCustomerPayments as any[]).filter(
                                (cp: any) => cp.sale_id === sale.id && cp.type === 'فاتورة معلقة تمت تسويتها'
                              );
                              const wasSettled = settledPayments.length > 0;
                              const totalPaid = Number(sale.paid_amount) || 0;
                              const isFullyPaid = totalPaid >= sale.total_amount;

                              let displayStatus: string;
                              let statusCls: string;

                              if (wasSettled) {
                                if (isFullyPaid) {
                                  displayStatus = 'مسدد ✓';
                                  statusCls = 'bg-emerald-100 text-emerald-700';
                                } else {
                                  displayStatus = 'جزئي';
                                  statusCls = 'bg-amber-100 text-amber-700';
                                }
                              } else if (sale.status === 'كاملة' || sale.status === 'مكتملة') {
                                displayStatus = 'مسدد ✓';
                                statusCls = 'bg-emerald-100 text-emerald-700';
                              } else if (sale.status === 'معلقة') {
                                displayStatus = 'معلقة';
                                statusCls = 'bg-orange-100 text-orange-700';
                              } else {
                                displayStatus = sale.status;
                                statusCls = 'bg-blue-100 text-blue-700';
                              }

                              return (
                                <span className={cn('text-xs px-1.5 py-0.5 rounded font-semibold leading-tight text-center', statusCls)}
                                  style={{ display: 'inline-block', maxWidth: '72px', whiteSpace: 'normal', lineHeight: '1.3' }}>
                                  {displayStatus}
                                </span>
                              );
                            })()}
                          </td>
                        ) : null}

                        {idx === 0 ? (
                          <td rowSpan={rowSpan} className="text-center align-middle">
                            <div className="flex flex-col items-center gap-1">
                              <button onClick={() => openInvoicePrint(sale)}
                                className="w-7 h-7 bg-gold-50 hover:bg-gold-100 text-gold-600 rounded-lg border border-gold-200 flex items-center justify-center mx-auto transition-all" title="طباعة">
                                <Printer className="w-3.5 h-3.5" />
                              </button>
                              {!isReadOnly && (
                                <button
                                  onClick={() => {
                                    interact('click');
                                    // فتح صفحة التسوية مع pre-select للفاتورة
                                    window.location.href = `/settlement?date=${sale.sale_date}`;
                                  }}
                                  className="w-7 h-7 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-lg border border-amber-200 flex items-center justify-center mx-auto transition-all" title="تعديل الفاتورة">
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  });
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
                  <td colSpan={3} className="px-4 py-3 text-sm font-bold text-white">
                    إجمالي {(daySales as any[]).length} فاتورة
                  </td>
                  <td className="px-3 py-3 text-center font-bold text-white/80 text-xs">
                    {fmtQ(saleDetailRows.reduce((s, r) => s + r.quantity, 0))}
                  </td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">
                    {EGP(totalSales)}
                  </td>
                  <td className="px-3 py-3 text-center font-black text-emerald-200 whitespace-nowrap" title="الكاش الأولي لحظة الإنشاء">
                    {EGP(totalCashSales)}
                  </td>
                  <td className="px-3 py-3 text-center font-black whitespace-nowrap" style={{color: totalProfit >= 0 ? '#6ee7b7' : '#fca5a5'}}>
                    {hasProfit ? EGP(totalProfit) : '—'}
                  </td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ══════ RETURNS TODAY ══════ */}
      {(dayReturns as any[]).length > 0 && (
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="font-bold text-sm text-red-800">مرتجعات اليوم</span>
              <span className="text-xs text-red-600 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">{(dayReturns as any[]).length}</span>
            </div>
            <div className="flex items-center gap-2">
              {purchaseReturns > 0 && <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">مرتجع شراء: +{EGP(purchaseReturns)}</span>}
              {salesReturns > 0 && <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">مرتجع مبيعات: -{EGP(salesReturns)}</span>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="daily-table min-w-[460px]">
              <thead>
                <tr style={{ background: 'linear-gradient(135deg,#991b1b,#b91c1c)' }}>
                  <th>#</th><th>النوع</th><th>العميل / المورد</th><th>الأصناف</th><th className="text-center">المبلغ</th><th className="text-center">الأثر</th>
                </tr>
              </thead>
              <tbody>
                {(dayReturns as any[]).map((r: any, i: number) => {
                  const items = (r.return_items || []) as any[];
                  const isSalesReturn = r.type === 'مبيعات';
                  return (
                    <tr key={r.id}>
                      <td className="text-center text-slate-400 text-xs">{i + 1}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${isSalesReturn ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>
                          مرتجع {r.type}
                        </span>
                      </td>
                      <td className="font-bold text-slate-700">{r.customer_name || r.supplier_name || '—'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {items.slice(0, 2).map((it: any, j: number) => (
                            <span key={j} className="text-xs bg-red-50 text-red-700 border border-red-100 px-1.5 py-0.5 rounded-md">{it.product_name} ×{it.quantity}</span>
                          ))}
                          {items.length > 2 && <span className="text-xs text-slate-400">+{items.length - 2}</span>}
                        </div>
                      </td>
                      <td className="text-center font-black text-red-600 whitespace-nowrap">{EGP(r.total_amount)}</td>
                      <td className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${isSalesReturn ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          {isSalesReturn ? '− صادر' : '+ وارد'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════ CUSTOMER PAYMENTS RECEIVED ══════ */}
      {(dayCustomerPayments as any[]).length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-b border-blue-100">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <span className="font-bold text-sm text-blue-800">تحصيلات العملاء</span>
              <span className="text-xs text-blue-600 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-full">{(dayCustomerPayments as any[]).length}</span>
            </div>
            <div className="flex items-center gap-3">
              {totalCPayCash > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  <Wallet className="w-3 h-3" />كاش: {EGP(totalCPayCash)}
                </span>
              )}
              {totalCPayWallet > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  <Smartphone className="w-3 h-3" />محفظة: {EGP(totalCPayWallet)}
                </span>
              )}
              <span className="font-bold text-sm text-blue-700">{EGP(totalCPay)}</span>
            </div>
          </div>
          {/* إشارة للدفعات المرتبطة بمبيعات اليوم */}
          {sameDayCPTotal > 0 && (
            <div className="px-4 py-2 bg-gold-50 border-b border-gold-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gold-500 flex-shrink-0" />
              <span className="text-xs text-gold-700 font-semibold">
                منها {EGP(sameDayCPTotal)} سداد لاحق على فواتير اليوم (تظهر في عمود المدفوع أعلاه)
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="daily-table min-w-[500px]">
              <thead>
                <tr style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
                  <th>#</th><th>العميل</th><th>نوع الدفعة</th><th>طريقة الدفع</th><th>الملاحظات</th><th className="text-center">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {visibleCPayments.map((p: any, i: number) => {
                  const isSameDay = daySaleIds.has(p.sale_id);
                  const pType = p.type || 'دفعة';
                  const label = pType === 'فاتورة معلقة تمت تسويتها' ? 'تسوية معلقة'
                    : isSameDay ? 'سداد لاحق — نفس اليوم'
                    : pType === 'تسديد آجل' ? 'سداد مديونية'
                    : 'دفعة';
                  const cls = pType === 'فاتورة معلقة تمت تسويتها'
                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : isSameDay
                    ? 'bg-gold-50 text-gold-700 border-gold-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';
                  return (
                    <tr key={p.id} className={isSameDay ? 'bg-gold-50/20' : ''}>
                      <td className="text-center text-slate-400 text-xs">{i + 1}</td>
                      <td className="font-bold text-blue-800">{p.customer_name || '—'}</td>
                      <td className="text-center">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold border', cls)}
                          style={{ display: 'inline-block', maxWidth: '110px', whiteSpace: 'normal', lineHeight: '1.3', textAlign: 'center' }}>
                          {label}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 w-fit ${
                          p.payment_method === 'محفظة'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {p.payment_method === 'محفظة'
                            ? <Smartphone className="w-2.5 h-2.5" />
                            : <Wallet className="w-2.5 h-2.5" />}
                          {p.payment_method || 'كاش'}
                        </span>
                      </td>
                      <td className="text-slate-500 text-xs">{p.notes || '—'}</td>
                      <td className="text-center font-black text-blue-700 whitespace-nowrap">{EGP(p.amount)}</td>
                    </tr>
                  );
                })}
                {visibleCPayments.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-4 text-slate-400 text-xs">لا توجد تحصيلات</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════ PURCHASES TODAY ══════ */}
      {(dayPurchases as any[]).length > 0 && (
        <div className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-violet-50 border-b border-violet-100">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-violet-600" />
              <span className="font-bold text-sm text-violet-800">مشتريات اليوم</span>
              <span className="text-xs text-violet-600 bg-violet-100 border border-violet-200 px-2 py-0.5 rounded-full">{(dayPurchases as any[]).length}</span>
            </div>
            <span className="font-bold text-sm text-violet-700">{EGP(totalPurchases)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="daily-table min-w-[640px]">
              <thead>
                <tr style={{ background: 'linear-gradient(135deg,#4c1d95,#6d28d9)' }}>
                  <th>#</th><th>المورد</th><th>الأصناف</th><th className="text-center">الإجمالي</th><th className="text-center">مدفوع</th><th className="text-center">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(dayPurchases as any[]).map((p: any, i: number) => {
                  const items = (p.purchase_items || []) as any[];
                  const remaining = p.total_amount - p.paid_amount;
                  return (
                    <tr key={p.id}>
                      <td className="text-center text-slate-400 text-xs">{i + 1}</td>
                      <td className="font-bold text-violet-800">{p.supplier_name || 'مورد'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {items.slice(0, 3).map((it: any, j: number) => (
                            <span key={j} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded-md">{it.product_name} ×{it.quantity}</span>
                          ))}
                          {items.length > 3 && <span className="text-xs text-slate-400">+{items.length - 3}</span>}
                        </div>
                      </td>
                      <td className="text-center font-bold text-violet-700 whitespace-nowrap">{EGP(p.total_amount)}</td>
                      <td className="text-center font-bold text-emerald-600 whitespace-nowrap">{EGP(p.paid_amount)}</td>
                      <td className="text-center">
                        {remaining > 0
                          ? <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-lg font-bold">{p.status}</span>
                          : <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-lg font-bold">مسدَّد ✓</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════ EXPENSES & WORKER TRANSACTIONS ══════ */}
      <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-red-500" />
            <span className="font-bold text-sm text-red-800">المصروفات والسلف</span>
            <span className="text-xs text-red-600 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">{dayExpenses.length + (dayWorkerTxns as any[]).length}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-bold text-sm text-red-600">{EGP(totalExpenses + totalWorkerAdv + totalWorkerSal)}</span>
                        {!isReadOnly && (              <button onClick={() => { interact('add'); setShowExpenseForm(true); }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl text-xs font-semibold transition-all">
                <span>+ إضافة</span>
              </button>            )}
          </div>
        </div>

        {(dayExpenses.length === 0 && (dayWorkerTxns as any[]).length === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Wallet className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm">لا توجد مصروفات لهذا اليوم</p>
            {!isReadOnly && (
              <button onClick={() => { interact('add'); setShowExpenseForm(true); }} className="mt-3 text-xs text-gold-600 font-medium">+ إضافة مصروف</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="daily-table min-w-[380px]">
              <thead>
                <tr style={{ background: 'linear-gradient(135deg,#991b1b,#b91c1c)' }}>
                  <th>#</th><th>البيان</th><th>الفئة / النوع</th><th className="text-center">المبلغ</th>
                  {!isReadOnly && <th className="text-center">حذف</th>}
                </tr>
              </thead>
              <tbody>
                {dayExpenses.map((e, i) => (
                  <tr key={e.id}>
                    <td className="text-center text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-semibold text-slate-800">{e.description}</td>
                    <td><span className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-lg">{e.category}</span></td>
                    <td className="text-center font-bold text-red-600 whitespace-nowrap">{EGP(e.amount)}</td>
                    {!isReadOnly && (
                      <td className="text-center">
                        <button onClick={() => deleteExpenseMutation.mutate(e.id)}
                          className="w-7 h-7 bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 rounded-lg flex items-center justify-center mx-auto border border-red-200 transition-all">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {(dayWorkerTxns as any[]).map((t: any, i: number) => (
                  <tr key={t.id} className="bg-amber-50/30">
                    <td className="text-center text-slate-400 text-xs">{dayExpenses.length + i + 1}</td>
                    <td className="font-semibold text-amber-800">{t.worker_name}</td>
                    <td>
                      <span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold',
                        t.type === 'سلفة' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-orange-100 text-orange-700 border-orange-200')}>
                        {t.type === 'سلفة' ? 'سلفة عامل' : 'مرتب عامل'}
                      </span>
                    </td>
                    <td className="text-center font-bold text-amber-700 whitespace-nowrap">{EGP(t.amount)}</td>
                    {!isReadOnly && <td />}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(135deg,#991b1b,#b91c1c)' }}>
                  <td colSpan={3} className="px-4 py-3 text-xs font-bold text-red-100">الإجمالي</td>
                  <td className="px-3 py-3 text-center font-black text-white whitespace-nowrap">{EGP(totalExpenses + totalWorkerAdv + totalWorkerSal)}</td>
                  {!isReadOnly && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ══════ BIG CASH ON HAND SUMMARY CARD ══════ */}
      <div className="rounded-2xl overflow-hidden shadow-lg border-2 border-gold-300" style={{ background: 'linear-gradient(135deg,#4d350d,#8a6118,#a97a1f)' }}>
        <div className="p-5">
          <p className="text-center text-white/70 text-xs font-bold uppercase tracking-widest mb-4">
            الخلاصة المالية النهائية ليوم {selectedDate}
          </p>

          <div className="grid grid-cols-1 gap-2 mb-5">
            {/* Money In */}
            <div className="bg-emerald-500/20 rounded-xl p-3 border border-emerald-400/30">
              <p className="text-emerald-200 text-xs font-bold mb-2">الأموال الواردة (+)</p>
              <div className="space-y-1.5">
                {[
                  openingBalance > 0 && { label: 'رصيد البداية', val: openingBalance },
                  totalCashSales > 0 && { label: 'كاش الفواتير عند الإنشاء', val: totalCashSales },
                  (totalCPayCash - sameDayCPTotal) > 0 && { label: 'تحصيل آجل كاش', val: totalCPayCash - sameDayCPTotal },
                  sameDayCPTotal > 0 && { label: 'سداد لاحق على مبيعات اليوم', val: sameDayCPTotal },
                  purchaseReturns > 0 && { label: 'مرتجعات مشتريات', val: purchaseReturns },
                ].filter(Boolean).map((item: any, i: number) => item && (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-white/70 text-xs">{item.label}</span>
                    <span className="font-bold text-emerald-300 text-sm">{EGP(item.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center border-t border-emerald-400/30 pt-1.5 mt-1">
                  <span className="text-white font-bold text-xs">مجموع الوارد</span>
                  <span className="font-black text-emerald-200 text-base">{EGP(totalMoneyIn)}</span>
                </div>
              </div>
            </div>

            {/* Money Out */}
            <div className="bg-red-500/20 rounded-xl p-3 border border-red-400/30">
              <p className="text-red-200 text-xs font-bold mb-2">الأموال الصادرة (-)</p>
              <div className="space-y-1.5">
                {[
                  totalCashPurch > 0 && { label: 'مشتريات كاش', val: totalCashPurch },
                  totalWalletPurch > 0 && { label: 'مشتريات محفظة (خارج الخزنة)', val: totalWalletPurch },
                  totalCPayWallet > 0 && { label: 'تحصيل محفظة (خارج الخزنة)', val: totalCPayWallet },
                  totalSPay > 0 && { label: 'سداد موردين', val: totalSPay },
                  totalExpenses > 0 && { label: 'مصروفات نثرية', val: totalExpenses },
                  totalWorkerAdv > 0 && { label: 'سلف عمال', val: totalWorkerAdv },
                  totalWorkerSal > 0 && { label: 'مرتبات عمال', val: totalWorkerSal },
                  salesReturns > 0 && { label: 'مرتجعات مبيعات', val: salesReturns },
                ].filter(Boolean).map((item: any, i: number) => item && (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-white/70 text-xs">{item.label}</span>
                    <span className="font-bold text-red-300 text-sm">-{EGP(item.val)}</span>
                  </div>
                ))}
                {totalMoneyOut === 0 && (
                  <p className="text-white/40 text-xs text-center py-2">لا توجد مصروفات</p>
                )}
                <div className="flex justify-between items-center border-t border-red-400/30 pt-1.5 mt-1">
                  <span className="text-white font-bold text-xs">مجموع الصادر</span>
                  <span className="font-black text-red-200 text-base">-{EGP(totalMoneyOut)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net result */}
          <div className={cn(
            'rounded-2xl p-5 text-center border-2',
            cashOnHand >= 0 ? 'bg-white/15 border-white/30' : 'bg-red-900/30 border-red-400/40'
          )}>
            <p className="text-white/60 text-xs font-medium mb-1">إجمالي الفلوس اللي معايا النهارده</p>
            <p className={cn('text-5xl font-black tracking-tight', cashOnHand >= 0 ? 'text-white' : 'text-red-300')}>
              {EGP(cashOnHand)}
            </p>
            {cashOnHand < 0 && (
              <p className="text-red-300 text-xs font-bold mt-2">⚠️ العجز يعني الصادر أكبر من الوارد</p>
            )}
          </div>

          {hasProfit && (
            <div className="mt-3 bg-white/10 rounded-xl p-3 border border-white/15 flex items-center justify-between">
              <span className="text-white/70 text-xs font-medium">صافي ربح اليوم (بعد خصم التكلفة)</span>
              <span className={cn('font-black text-lg', totalProfit >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                {EGP(totalProfit)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Expense Modal ── */}
      {showExpenseForm && !isReadOnly && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center"><Wallet className="w-4 h-4 text-white" /></div>
              <h2 className="text-base font-bold text-slate-800">إضافة مصروف</h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">البيان *</label>
                <input type="text" value={expenseForm.description}
                  onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="وصف المصروف" className="app-input" autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">المبلغ (ج.م)</label>
                <input type="number" value={expenseForm.amount || ''}
                  onChange={e => setExpenseForm(p => ({ ...p, amount: Number(e.target.value) }))}
                  className="app-input" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">الفئة</label>
                <select value={expenseForm.category} onChange={e => setExpenseForm(p => ({ ...p, category: e.target.value }))} className="app-input">
                  {['عام', 'إيجار', 'كهرباء', 'مياه', 'نقل', 'صيانة', 'تسويق', 'إدارية'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 font-semibold transition-all"
                onClick={() => {
                  if (!expenseForm.description || !expenseForm.amount) { toast.error('يرجى تعبئة البيان والمبلغ'); return; }
                  addExpenseMutation.mutate();
                }}
                disabled={addExpenseMutation.isPending}>
                {addExpenseMutation.isPending ? 'جاري...' : 'إضافة المصروف'}
              </button>
              <button className="flex-1 btn-secondary" onClick={() => setShowExpenseForm(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Inline Edit Invoice Modal ══ */}
      {editingDailyInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-100 animate-fade-up my-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center"><Edit2 className="w-4 h-4 text-white" /></div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">تعديل الفاتورة</h2>
                  <p className="text-xs text-slate-400">{editingDailyInvoice.customer_name || 'عميل نقدي'}</p>
                </div>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center"
                onClick={() => setEditingDailyInvoice(null)}><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* أصناف */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-700">أصناف الفاتورة</p>
                  <button onClick={addDailyEditItem}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-xs font-semibold border border-amber-200">
                    <Plus className="w-3 h-3" />إضافة صنف
                  </button>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {dailyEditItems.map(item => (
                    <div key={item.id} className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1.5">
                      <input type="text" placeholder="اسم الصنف" value={item.product_name}
                        onChange={e => updateDailyEditItem(item.id, 'product_name', e.target.value)}
                        className="w-full bg-white border border-amber-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none" />
                      <div className="grid grid-cols-12 gap-1.5 items-center">
                        <input type="number" placeholder="الكمية" value={item.quantity || ''}
                          onChange={e => updateDailyEditItem(item.id, 'quantity', Number(e.target.value))}
                          className="col-span-3 bg-white border border-amber-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none" />
                        <input type="text" placeholder="الوحدة" value={item.unit}
                          onChange={e => updateDailyEditItem(item.id, 'unit', e.target.value)}
                          className="col-span-2 bg-white border border-amber-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none" />
                        <input type="number" placeholder="السعر" value={item.unit_price || ''}
                          onChange={e => updateDailyEditItem(item.id, 'unit_price', Number(e.target.value))}
                          className="col-span-4 bg-white border border-amber-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none" />
                        <span className="col-span-2 text-xs font-bold text-amber-700 text-center">
                          {item.total_price > 0 ? EGP(item.total_price) : '—'}
                        </span>
                        <button onClick={() => removeDailyEditItem(item.id)}
                          className="col-span-1 w-6 h-6 bg-red-50 hover:bg-red-100 text-red-400 rounded-lg flex items-center justify-center">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {dailyEditItems.length === 0 && (
                    <div className="text-center py-6 text-slate-400 text-xs border-2 border-dashed border-amber-200 rounded-xl bg-amber-50/30">
                      اضغط "إضافة صنف" لتعديل أصناف الفاتورة
                    </div>
                  )}
                </div>
              </div>
              {/* التفاصيل */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">المدفوع (ج.م)</label>
                  <input type="number" value={dailyEditForm.paid_amount || ''}
                    onChange={e => setDailyEditForm(p => ({ ...p, paid_amount: Number(e.target.value) }))}
                    className="bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-amber-400" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">الخصم (ج.م)</label>
                  <input type="number" value={dailyEditForm.discount || ''}
                    onChange={e => setDailyEditForm(p => ({ ...p, discount: Number(e.target.value) }))}
                    className="bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-amber-400" />
                </div>
              </div>
              {/* ملخص */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1 text-xs">
                {dailyEditItems.length > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">إجمالي الأصناف:</span><span className="font-bold">{EGP(dailyEditItems.reduce((s,i)=>s+i.total_price,0))}</span></div>
                )}
                <div className="flex justify-between font-bold border-t border-amber-200 pt-1">
                  <span>الإجمالي بعد الخصم:</span>
                  <span className="text-amber-700">{EGP(Math.max(0, (dailyEditItems.length > 0 ? dailyEditItems.reduce((s,i)=>s+i.total_price,0) : dailyEditForm.total_amount) - (dailyEditForm.discount||0)))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">الحالة بعد التعديل:</span>
                  <span className={cn('font-bold px-1.5 py-0.5 rounded text-xs',
                    dailyEditForm.paid_amount >= Math.max(0,(dailyEditItems.length>0?dailyEditItems.reduce((s,i)=>s+i.total_price,0):dailyEditForm.total_amount)-(dailyEditForm.discount||0))
                      ? 'bg-emerald-100 text-emerald-700' : dailyEditForm.paid_amount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                    {dailyEditForm.paid_amount >= Math.max(0,(dailyEditItems.length>0?dailyEditItems.reduce((s,i)=>s+i.total_price,0):dailyEditForm.total_amount)-(dailyEditForm.discount||0)) ? 'كاملة ✓' : dailyEditForm.paid_amount > 0 ? 'جزئي' : 'معلقة'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => saveDailyEditMutation.mutate()}
                disabled={saveDailyEditMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-60">
                <Save className="w-3.5 h-3.5" />{saveDailyEditMutation.isPending ? 'جاري...' : 'حفظ التعديلات'}
              </button>
              <button onClick={() => setEditingDailyInvoice(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm transition-all">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Daily;
