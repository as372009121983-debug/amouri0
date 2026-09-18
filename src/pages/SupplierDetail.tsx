import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Truck, Edit2, Trash2, Phone, MapPin, CreditCard, ArrowLeft, X } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Supplier } from '@/types';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const INPUT = 'app-input';

const SupplierDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { interact } = useInteraction();
  const qc = useQueryClient();

  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: 0, notes: '', payment_date: new Date().toISOString().split('T')[0] });
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', notes: '' });

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Supplier;
    },
    enabled: !!id,
  });

  const { data: supplierPurchases = [] } = useQuery({
    queryKey: ['supplier-detail-purchases', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('purchases').select('id,total_amount,paid_amount,purchase_date,status,purchase_items(product_name,quantity)').eq('supplier_id', id!).order('purchase_date', { ascending: false }).limit(30);
      return (data || []) as any[];
    },
  });

  const { data: supplierPayments = [] } = useQuery({
    queryKey: ['supplier-payments-detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('supplier_payments').select('*').eq('supplier_id', id!).order('payment_date', { ascending: false }).limit(20);
      return (data || []) as any[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('suppliers').update(editForm).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-detail', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      interact('success'); toast.success('تم تحديث المورد');
      setShowEdit(false);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      interact('delete'); toast.success('تم حذف المورد');
      navigate('/suppliers');
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!supplier) return;
      await supabase.from('supplier_payments').insert({ supplier_id: id, supplier_name: supplier.name, amount: paymentForm.amount, notes: paymentForm.notes, payment_date: paymentForm.payment_date });
      await supabase.from('suppliers').update({ balance: Math.max(0, (supplier.balance || 0) - paymentForm.amount) }).eq('id', id!);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-detail', id] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['supplier-payments-detail', id] });
      interact('success'); toast.success('تم تسجيل الدفعة');
      setShowPayment(false);
      setPaymentForm({ amount: 0, notes: '', payment_date: new Date().toISOString().split('T')[0] });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;
  if (!supplier) return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Truck className="w-12 h-12 mb-3 opacity-25" />
      <p>لم يتم العثور على المورد</p>
      <button className="mt-4 btn-primary" onClick={() => navigate('/suppliers')}>العودة</button>
    </div>
  );

  const deferredPurchases = supplierPurchases.filter((p: any) => p.status === 'آجل' || p.status === 'جزئي');
  const totalOwed = deferredPurchases.reduce((s: number, p: any) => s + (p.total_amount - p.paid_amount), 0);

  return (
    <div className="space-y-5">
      {/* Back */}
      <button onClick={() => navigate('/suppliers')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" />العودة للموردين
      </button>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-slate-700 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Truck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{supplier.name}</h1>
              {supplier.phone && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-1">
                  <Phone className="w-3.5 h-3.5" /><span dir="ltr">{supplier.phone}</span>
                </div>
              )}
              {supplier.location && (
                <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" /><span>{supplier.location}</span>
                </div>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold border',
              supplier.balance > 0 ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200')}>
              {supplier.balance > 0 ? 'مستحق' : 'سوا'}
            </span>
            <p className={cn('font-black text-2xl mt-1', supplier.balance > 0 ? 'text-amber-600' : 'text-emerald-600')}>
              {EGP(Math.abs(supplier.balance))}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {supplier.balance > 0 && (
            <button
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold min-w-[120px]"
              onClick={() => setShowPayment(true)}>
              <CreditCard className="w-4 h-4" />تسديد للمورد
            </button>
          )}
          <button
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50"
            onClick={() => { setEditForm({ name: supplier.name, phone: supplier.phone || '', location: supplier.location || '', notes: supplier.notes || '' }); setShowEdit(true); }}>
            <Edit2 className="w-4 h-4" />تعديل
          </button>
          <button
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100"
            onClick={() => { if (confirm(`حذف "${supplier.name}"؟`)) deleteMutation.mutate(); }}>
            <Trash2 className="w-4 h-4" />حذف
          </button>
        </div>
      </div>

      {/* Deferred */}
      {deferredPurchases.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <h2 className="font-bold text-amber-800">فواتير آجلة ({deferredPurchases.length})</h2>
            <span className="font-bold text-red-600">{EGP(totalOwed)}</span>
          </div>
          <div className="divide-y divide-amber-50">
            {deferredPurchases.map((pur: any) => {
              const remaining = pur.total_amount - pur.paid_amount;
              const items = pur.purchase_items || [];
              return (
                <div key={pur.id} className="px-5 py-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-amber-800">{pur.purchase_date}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {items.slice(0, 3).map((it: any, j: number) => (
                        <span key={j} className="text-xs text-slate-500">{it.product_name} ×{it.quantity}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">{EGP(pur.total_amount)}</p>
                    <p className="font-bold text-red-600 text-sm">باقي: {EGP(remaining)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Purchases */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
            جميع المشتريات ({supplierPurchases.length})
          </h2>
        </div>
        {supplierPurchases.length > 0 ? (
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {supplierPurchases.map((pur: any) => {
              const items = pur.purchase_items || [];
              const remaining = pur.total_amount - pur.paid_amount;
              return (
                <div key={pur.id} className={cn('px-5 py-3.5', remaining > 0 ? 'bg-amber-50/50' : '')}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800">{pur.purchase_date}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {items.slice(0, 3).map((it: any, j: number) => (
                          <span key={j} className="text-xs text-slate-500">{it.product_name} ×{it.quantity}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-violet-600 text-sm">{EGP(pur.total_amount)}</p>
                      {remaining > 0 ? <p className="text-xs text-amber-600 font-semibold mt-0.5">متبقي: {EGP(remaining)}</p> : <span className="text-xs text-emerald-600 font-medium block mt-0.5">✓ مسدَّد</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <p className="text-sm">لا توجد مشتريات من هذا المورد</p>
          </div>
        )}
      </div>

      {/* Payment History */}
      {supplierPayments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />سجل الدفعات ({supplierPayments.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {supplierPayments.map((pay: any) => (
              <div key={pay.id} className="flex justify-between items-center px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-blue-600">دفعة</p>
                  {pay.notes && <p className="text-xs text-slate-400">{pay.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-emerald-600">{EGP(pay.amount)}</p>
                  <p className="text-xs text-slate-400">{pay.payment_date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><CreditCard className="w-4 h-4 text-white" /></div>
              <div>
                <h2 className="font-bold text-slate-800">تسجيل دفعة للمورد</h2>
                <p className="text-xs text-slate-400">مستحق: <span className="text-amber-600 font-bold">{EGP(supplier.balance)}</span></p>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">المبلغ (ج.م) *</label>
                <input type="number" value={paymentForm.amount || ''} onChange={e => setPaymentForm(p => ({ ...p, amount: Number(e.target.value) }))} className={INPUT} autoFocus />
                {supplier.balance > 0 && (
                  <button className="text-xs text-slate-600 text-right" onClick={() => setPaymentForm(p => ({ ...p, amount: supplier.balance }))}>
                    تسديد كامل: {EGP(supplier.balance)}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">التاريخ</label><input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} className={INPUT} /></div>
              <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-slate-600">ملاحظات</label><input type="text" value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} className={INPUT} /></div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-white rounded-xl py-2.5 font-semibold" onClick={() => { if (!paymentForm.amount) { toast.error('يرجى إدخال المبلغ'); return; } paymentMutation.mutate(); }} disabled={paymentMutation.isPending}>{paymentMutation.isPending ? 'جاري...' : 'تسجيل الدفعة'}</button>
              <button className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5" onClick={() => setShowPayment(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Truck className="w-4 h-4 text-white" /></div>
              <h2 className="font-bold text-slate-800">تعديل المورد</h2>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم المورد *', key: 'name' }, { label: 'رقم الهاتف', key: 'phone' }, { label: 'الموقع', key: 'location' }, { label: 'ملاحظات', key: 'notes' }].map(({ label, key }) => (
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

export default SupplierDetail;
