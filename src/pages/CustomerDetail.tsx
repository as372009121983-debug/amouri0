import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Edit2, Trash2, Phone, MapPin, CreditCard, X, CheckCircle, Package, ArrowRight, ArrowLeft, Wallet, Smartphone, ClipboardCheck } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/types';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const INPUT = 'app-input';

interface PaymentResult {
  totalPaid: number;
  settledInvoices: { id: string; date: string; products: string[]; amount: number }[];
  partialInvoice?: { id: string; date: string; partPaid: number };
}

/* ── زر حذف الدفعة مع إعادة المبلغ كمديونية على العميل ── */
const DeletePaymentButton = ({
  payId, amount, customerId, customerBalance, qc, interact,
}: {
  payId: string; amount: number; customerId: string; customerBalance: number;
  saleId?: string; qc: QueryClient; interact: (e: string) => void;
}) => {
  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customer_payments').delete().eq('id', payId);
      if (error) throw error;
      const { data: cust } = await supabase.from('customers').select('balance').eq('id', customerId).single();
      if (cust) {
        await supabase.from('customers').update({ balance: (cust.balance || 0) + amount }).eq('id', customerId);
      }
      const { data: allSales } = await supabase
        .from('sales')
        .select('id,total_amount,paid_amount,status')
        .eq('customer_id', customerId)
        .order('sale_date', { ascending: false });
      
      if (allSales && allSales.length > 0) {
        let remainingToDeduct = amount;
        for (const s of allSales) {
          if (remainingToDeduct <= 0) break;
          if (s.status !== 'كاملة' && s.status !== 'مكتملة') continue;
          const canDeduct = Math.min(remainingToDeduct, s.paid_amount);
          const newPaid = Math.max(0, s.paid_amount - canDeduct);
          const newStatus = newPaid <= 0 ? 'معلقة' : newPaid < s.total_amount ? 'جزئي' : 'كاملة';
          await supabase.from('sales').update({ paid_amount: newPaid, status: newStatus }).eq('id', s.id);
          remainingToDeduct -= canDeduct;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-payments-detail', customerId] });
      qc.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      qc.invalidateQueries({ queryKey: ['customer-detail-sales', customerId] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      interact('delete');
      toast.success(`تم حذف الدفعة — ${EGP(amount)} عادت كمديونية على العميل`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <button
      className="w-8 h-8 bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 rounded-xl flex items-center justify-center border border-red-200 transition-all flex-shrink-0"
      onClick={() => { if (confirm(`حذف هذه الدفعة (${EGP(amount)})؟\nسيعود المبلغ كمديونية على العميل.`)) deleteMut.mutate(); }}
      disabled={deleteMut.isPending}
      title="حذف الدفعة وإعادتها مديونية">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
};

const CustomerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { interact } = useInteraction();
  const qc = useQueryClient();

  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0, notes: '', payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'كاش' as 'كاش' | 'محفظة',
  });
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', notes: '' });

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Customer;
    },
    enabled: !!id,
    staleTime: 0,
  });

  const { data: customerSales = [] } = useQuery({
    queryKey: ['customer-detail-sales', id],
    enabled: !!id,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('id,customer_id,total_amount,paid_amount,sale_date,status,sale_items(product_name,quantity,product_id)')
        .eq('customer_id', id!)
        .order('sale_date', { ascending: true });
      return (data || []) as any[];
    },
  });

  const { data: customerPayments = [] } = useQuery({
    queryKey: ['customer-payments-detail', id],
    enabled: !!id,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_payments')
        .select('*')
        .eq('customer_id', id!)
        .order('payment_date', { ascending: false })
        .limit(30);
      return (data || []) as any[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customers').update(editForm).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-detail', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      interact('success'); toast.success('تم تحديث العميل');
      setShowEdit(false);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customers').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      interact('delete'); toast.success('تم حذف العميل');
      navigate('/customers');
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ── Smart Payment Mutation ── */
  const smartPaymentMutation = useMutation({
    mutationFn: async (): Promise<PaymentResult> => {
      if (!customer) throw new Error('لم يتم العثور على العميل');
      const amt = paymentForm.amount;
      if (amt <= 0) throw new Error('يرجى إدخال مبلغ صحيح');

      /*
       * نجلب كل الفواتير غير المكتملة — يشمل معلقة ومؤجلة وجزئي وآجل
       * مرتبة من الأقدم للأحدث لضمان سداد الأقدم أولاً
       */
      const { data: pendingSales } = await supabase
        .from('sales')
        .select('id,sale_date,total_amount,paid_amount,sale_items(product_name,quantity)')
        .eq('customer_id', id!)
        .in('status', ['آجل', 'جزئي', 'معلقة', 'مؤجلة'])
        .order('sale_date', { ascending: true });

      const invoices = (pendingSales || []) as any[];
      let remaining = amt;
      const result: PaymentResult = { totalPaid: amt, settledInvoices: [], partialInvoice: undefined };
      const firstSaleId = invoices[0]?.id || null;

      for (const inv of invoices) {
        if (remaining <= 0) break;
        const invRemaining = inv.total_amount - inv.paid_amount;
        if (invRemaining <= 0) continue;
        const toPay = Math.min(remaining, invRemaining);
        const newPaid = inv.paid_amount + toPay;
        const newStatus = newPaid >= inv.total_amount ? 'كاملة' : 'جزئي';

        /*
         * نُحدِّث paid_amount مباشرةً — يضمن تحديث الـ UI فوراً
         * الـ trigger سيُعيد الحساب عند إدراج customer_payments لكن النتيجة ستكون مطابقة
         */
        await supabase.from('sales').update({ paid_amount: newPaid, status: newStatus }).eq('id', inv.id);

        const products = (inv.sale_items || []).map((it: any) => `${it.product_name} ×${it.quantity}`);
        if (newStatus === 'كاملة') {
          result.settledInvoices.push({ id: inv.id, date: inv.sale_date, products, amount: toPay });
        } else {
          result.partialInvoice = { id: inv.id, date: inv.sale_date, partPaid: toPay };
        }
        remaining -= toPay;
      }

      // تحديث رصيد العميل
      await supabase.from('customers').update({ balance: Math.max(0, (customer.balance || 0) - amt) }).eq('id', id!);

      // إنشاء سجل customer_payments مرتبط بأول فاتورة
      await supabase.from('customer_payments').insert({
        customer_id: id,
        customer_name: customer.name,
        amount: amt,
        type: 'دفعة',
        notes: paymentForm.notes || `سداد مديونية — ${result.settledInvoices.length} فاتورة مكتملة`,
        payment_date: paymentForm.payment_date,
        payment_method: paymentForm.payment_method,
        sale_id: result.settledInvoices[0]?.id || result.partialInvoice?.id || firstSaleId,
      });

      return result;
    },
    onSuccess: async (data) => {
      // refetch فوري لضمان تحديث الـ UI بلا تأخير
      await Promise.all([
        qc.refetchQueries({ queryKey: ['customer-detail', id] }),
        qc.refetchQueries({ queryKey: ['customer-detail-sales', id] }),
        qc.refetchQueries({ queryKey: ['customer-payments-detail', id] }),
      ]);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['daily-sales'] });
      qc.invalidateQueries({ queryKey: ['daily-cpayments'] });
      interact('success');
      setShowPayment(false);
      setPaymentResult(data);
      setPaymentForm({ amount: 0, notes: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'كاش' });
      toast.success(`تم تسجيل ${EGP(data.totalPaid)} — تم تسوية ${data.settledInvoices.length} فاتورة`);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;
  if (!customer) return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Users className="w-12 h-12 mb-3 opacity-25" />
      <p>لم يتم العثور على العميل</p>
      <button className="mt-4 btn-primary" onClick={() => navigate('/customers')}>العودة</button>
    </div>
  );

  /* الفواتير غير المكتملة — تشمل جميع الحالات المعلقة */
  const deferredSales = customerSales.filter((s: any) =>
    ['آجل', 'جزئي', 'معلقة', 'مؤجلة'].includes(s.status)
  );
  const totalCashPaid = customerPayments.filter((p: any) => (p.payment_method || 'كاش') === 'كاش').reduce((s: number, p: any) => s + p.amount, 0);
  const totalWalletPaid = customerPayments.filter((p: any) => p.payment_method === 'محفظة').reduce((s: number, p: any) => s + p.amount, 0);

  return (
    <div className="space-y-5">
      {/* Back Button */}
      <button onClick={() => navigate('/customers')}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" />العودة للعملاء
      </button>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xl">{customer.name.charAt(0)}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{customer.name}</h1>
              {customer.phone && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-1"><Phone className="w-3.5 h-3.5" /><span dir="ltr">{customer.phone}</span></div>
              )}
              {customer.location && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-0.5"><MapPin className="w-3.5 h-3.5" /><span>{customer.location}</span></div>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold border',
              customer.balance > 0 ? 'bg-red-50 text-red-600 border-red-200' :
              customer.balance < 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
              'bg-slate-100 text-slate-500 border-slate-200')}>
              {customer.balance > 0 ? 'مديون' : customer.balance < 0 ? 'دائن' : 'سوا'}
            </span>
            <p className={cn('font-black text-2xl mt-1', customer.balance > 0 ? 'text-red-600' : customer.balance < 0 ? 'text-emerald-600' : 'text-slate-400')}>
              {EGP(Math.abs(customer.balance))}
            </p>
          </div>
        </div>

        {/* Payment method breakdown */}
        {(totalCashPaid > 0 || totalWalletPaid > 0) && (
          <div className="flex gap-2 mb-4">
            {totalCashPaid > 0 && (
              <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-xl p-2 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <div><p className="text-xs text-emerald-600 font-medium">كاش</p><p className="font-bold text-emerald-700 text-sm">{EGP(totalCashPaid)}</p></div>
              </div>
            )}
            {totalWalletPaid > 0 && (
              <div className="flex-1 bg-blue-50 border border-blue-200 rounded-xl p-2 flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                <div><p className="text-xs text-blue-600 font-medium">محفظة</p><p className="font-bold text-blue-700 text-sm">{EGP(totalWalletPaid)}</p></div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {customer.balance > 0 && (
            <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-all min-w-[120px]"
              onClick={() => setShowPayment(true)}>
              <CreditCard className="w-4 h-4" />تسديد مديونية
            </button>
          )}
          {deferredSales.length > 0 && (
            <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-50 border border-orange-200 text-orange-700 rounded-xl text-sm font-semibold hover:bg-orange-100 transition-all"
              onClick={() => navigate('/daily-settlement')}>
              <ClipboardCheck className="w-4 h-4" />صفحة التسوية
            </button>
          )}
          <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all"
            onClick={() => { setEditForm({ name: customer.name, phone: customer.phone || '', location: customer.location || '', notes: customer.notes || '' }); setShowEdit(true); }}>
            <Edit2 className="w-4 h-4" />تعديل
          </button>
          <button className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 transition-all"
            onClick={() => { if (confirm(`هل تريد حذف العميل "${customer.name}"؟`)) deleteMutation.mutate(); }}>
            <Trash2 className="w-4 h-4" />حذف
          </button>
        </div>
      </div>

      {/* Deferred Invoices */}
      {deferredSales.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <h2 className="font-bold text-amber-800">فواتير غير مكتملة ({deferredSales.length})</h2>
              <span className="mr-auto font-bold text-red-600 text-sm">
                {EGP(deferredSales.reduce((s: number, x: any) => s + (x.total_amount - x.paid_amount), 0))}
              </span>
            </div>
          </div>
          <div className="divide-y divide-amber-50">
            {deferredSales.map((sale: any, idx: number) => {
              const remaining = sale.total_amount - sale.paid_amount;
              const items = sale.sale_items || [];
              return (
                <div key={sale.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="text-sm font-bold text-amber-800">#{idx + 1} — {sale.sale_date}</span>
                        <span className={cn('text-xs px-2 py-0.5 rounded-lg font-bold border flex-shrink-0',
                          sale.status === 'معلقة' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                          sale.status === 'مؤجلة' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          'bg-amber-100 text-amber-700 border-amber-300')}>
                          {sale.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {items.slice(0, 4).map((it: any, j: number) => (
                          <span key={j} className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-lg">{it.product_name} ×{it.quantity}</span>
                        ))}
                        {items.length > 4 && <span className="text-xs text-amber-500">+{items.length - 4}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-400">الإجمالي: {EGP(sale.total_amount)}</p>
                      {sale.paid_amount > 0 && <p className="text-xs text-emerald-600">مدفوع: {EGP(sale.paid_amount)}</p>}
                      <p className="font-bold text-base text-red-600">باقي: {EGP(remaining)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Sales */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            جميع الفواتير ({customerSales.length})
          </h2>
        </div>
        {customerSales.length > 0 ? (
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {[...customerSales].reverse().map((sale: any) => {
              const items = sale.sale_items || [];
              const remaining = sale.total_amount - sale.paid_amount;
              return (
                <div key={sale.id} className={cn('px-5 py-3.5', remaining > 0 ? 'bg-amber-50/50' : '')}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800">{sale.sale_date}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {items.slice(0, 3).map((it: any, j: number) => (
                          <span key={j} className="text-xs text-slate-500">{it.product_name} ×{it.quantity}</span>
                        ))}
                        {items.length > 3 && <span className="text-xs text-slate-400">+{items.length - 3}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-emerald-600 text-sm">{EGP(sale.total_amount)}</p>
                      {remaining > 0
                        ? <p className="text-xs text-amber-600 font-semibold mt-0.5">متبقي: {EGP(remaining)}</p>
                        : <span className="text-xs text-emerald-600 font-medium block mt-0.5">✓ مكتملة</span>
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <p className="text-sm">لا توجد فواتير لهذا العميل</p>
          </div>
        )}
      </div>

      {/* Payments History — with delete button */}
      {customerPayments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              سجل الدفعات ({customerPayments.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
            {customerPayments.map((pay: any) => (
              <div key={pay.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-blue-600">{pay.type}</span>
                    {(pay.payment_method || 'كاش') && (
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1',
                        pay.payment_method === 'محفظة'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                        {pay.payment_method === 'محفظة' ? <Smartphone className="w-2.5 h-2.5" /> : <Wallet className="w-2.5 h-2.5" />}
                        {pay.payment_method || 'كاش'}
                      </span>
                    )}
                  </div>
                  {pay.notes && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{pay.notes}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-emerald-600">{EGP(pay.amount)}</p>
                  <p className="text-xs text-slate-400">{pay.payment_date}</p>
                </div>
                <DeletePaymentButton
                  payId={pay.id}
                  amount={pay.amount}
                  customerId={id!}
                  customerBalance={customer.balance}
                  qc={qc}
                  interact={interact}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800">تسجيل دفعة</h2>
                <p className="text-xs text-slate-400">الرصيد: <span className="text-red-600 font-bold">{EGP(customer.balance)}</span></p>
              </div>
            </div>
            <div className="mx-6 mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <p className="text-xs text-blue-700 font-semibold">سداد ذكي — يخصم من الأقدم للأحدث تلقائياً ويُحدِّث الفواتير فوراً</p>
            </div>
            <div className="p-6 space-y-3">
              {/* طريقة الدفع */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">طريقة الدفع</label>
                <div className="flex gap-2">
                  {([
                    { value: 'كاش', label: 'كاش', Icon: Wallet },
                    { value: 'محفظة', label: 'محفظة إلكترونية', Icon: Smartphone },
                  ] as const).map(m => (
                    <button key={m.value} type="button"
                      onClick={() => setPaymentForm(p => ({ ...p, payment_method: m.value }))}
                      className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border transition-all',
                        paymentForm.payment_method === m.value
                          ? m.value === 'كاش' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                      <m.Icon className="w-3.5 h-3.5" />{m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">المبلغ (ج.م) *</label>
                <input type="number" value={paymentForm.amount || ''} onChange={e => setPaymentForm(p => ({ ...p, amount: Number(e.target.value) }))} className={INPUT} autoFocus />
                {customer.balance > 0 && (
                  <button className="text-xs text-emerald-600 text-right font-medium" onClick={() => setPaymentForm(p => ({ ...p, amount: customer.balance }))}>
                    تسديد كامل: {EGP(customer.balance)}
                  </button>
                )}
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
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 font-semibold"
                onClick={() => { if (!paymentForm.amount) { toast.error('يرجى إدخال المبلغ'); return; } smartPaymentMutation.mutate(); }}
                disabled={smartPaymentMutation.isPending}>
                {smartPaymentMutation.isPending ? 'جاري...' : 'تسجيل الدفعة'}
              </button>
              <button className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5" onClick={() => setShowPayment(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Result */}
      {paymentResult && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 bg-emerald-50">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
                <div>
                  <h2 className="font-bold text-emerald-800">تم تسجيل الدفعة</h2>
                  <p className="text-xs text-emerald-600">إجمالي: <strong>{EGP(paymentResult.totalPaid)}</strong></p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {paymentResult.settledInvoices.length > 0 && (
                <div>
                  <p className="text-sm font-bold text-slate-700 mb-3">فواتير مسدَّدة ({paymentResult.settledInvoices.length})</p>
                  <div className="space-y-2">
                    {paymentResult.settledInvoices.map((inv, i) => (
                      <div key={i} className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs text-emerald-600 font-semibold">{inv.date}</span>
                          <span className="font-bold text-emerald-700 text-sm">{EGP(inv.amount)}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {inv.products.map((p, j) => (
                            <span key={j} className="text-xs bg-white border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                              <Package className="w-2.5 h-2.5" />{p}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {paymentResult.partialInvoice && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-sm font-semibold text-amber-700 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" />دفعة جزئية — {paymentResult.partialInvoice.date}
                  </p>
                  <p className="text-xs text-amber-600 mt-1">مدفوع: {EGP(paymentResult.partialInvoice.partPaid)}</p>
                </div>
              )}
              {paymentResult.settledInvoices.length === 0 && !paymentResult.partialInvoice && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-sm text-blue-700">تم تسجيل الدفعة في سجل التحصيلات</p>
                </div>
              )}
              <button className="btn-primary w-full" onClick={() => setPaymentResult(null)}>تم</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Users className="w-4 h-4 text-white" /></div>
              <h2 className="font-bold text-slate-800">تعديل العميل</h2>
            </div>
            <div className="p-6 space-y-3">
              {[
                { label: 'اسم العميل *', key: 'name' },
                { label: 'رقم الهاتف', key: 'phone' },
                { label: 'الموقع', key: 'location' },
                { label: 'ملاحظات', key: 'notes' },
              ].map(({ label, key }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(editForm[key as keyof typeof editForm])} onChange={e => setEditForm(p => ({ ...p, [key]: e.target.value }))} className={INPUT} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 btn-primary" onClick={() => { if (!editForm.name) { toast.error('يرجى إدخال الاسم'); return; } updateMutation.mutate(); }} disabled={updateMutation.isPending}>حفظ</button>
              <button className="flex-1 btn-secondary" onClick={() => setShowEdit(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerDetail;
