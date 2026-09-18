import { useState, useMemo } from 'react';
import {
  CheckCircle2, Clock, Wallet, Smartphone, X, Calendar,
  Hash, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const today = () => new Date().toISOString().split('T')[0];
const INPUT = 'app-input';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  'كاملة':  { label: 'كاملة',  className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  'مؤجلة':  { label: 'مؤجلة',  className: 'text-blue-700   bg-blue-50   border-blue-200'   },
  'جزئي':   { label: 'جزئي',   className: 'text-amber-700  bg-amber-50  border-amber-200'  },
  'معلقة':  { label: 'معلقة',  className: 'text-orange-700 bg-orange-50 border-orange-200' },
};

type SettleEntry = {
  paid: number;
  method: 'كاش' | 'محفظة';
  walletFrom: string;
  walletTo: string;
  finalStatus: string;
};

const Settlement = () => {
  const { interact } = useInteraction();
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(today());
  const [entries, setEntries] = useState<Record<string, SettleEntry>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settled, setSettled] = useState<string[]>([]);

  /* ─── Query: fواتير معلقة أو مؤجلة للتاريخ المحدد ─── */
  const { data: pendingSales = [], isLoading, refetch } = useQuery({
    queryKey: ['settlement-sales', selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .in('status', ['معلقة', 'مؤجلة'])
        .eq('sale_date', selectedDate)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 15000,
  });

  /* ─── إعداد خيارات التسوية ─── */
  const getEntry = (saleId: string, total: number): SettleEntry =>
    entries[saleId] ?? { paid: total, method: 'كاش', walletFrom: '', walletTo: '', finalStatus: 'تلقائي' };

  const setEntry = (saleId: string, patch: Partial<SettleEntry>) =>
    setEntries(prev => ({ ...prev, [saleId]: { ...getEntry(saleId, 0), ...patch } }));

  /* ─── Mutation: تسوية فاتورة واحدة ─── */
  const settleSingleMutation = useMutation({
    mutationFn: async (sale: any) => {
      const entry = getEntry(sale.id, sale.total_amount);
      const newPaid = Math.min(sale.total_amount, Math.max(0, entry.paid));
      const remaining = sale.total_amount - newPaid;

      let finalStatus: string;
      if (entry.finalStatus !== 'تلقائي' && entry.finalStatus) {
        finalStatus = entry.finalStatus;
        if (newPaid >= sale.total_amount) finalStatus = 'كاملة';
      } else {
        finalStatus = newPaid >= sale.total_amount ? 'كاملة' : newPaid > 0 ? 'جزئي' : 'مؤجلة';
      }

      await supabase.from('sales').update({
        paid_amount: newPaid,
        initial_paid_amount: newPaid,
        status: finalStatus,
        payment_method: entry.method,
        wallet_from: entry.method === 'محفظة' ? entry.walletFrom : null,
        wallet_to: entry.method === 'محفظة' ? entry.walletTo : null,
      }).eq('id', sale.id);

      if (sale.customer_id) {
        const { data: cust } = await supabase.from('customers').select('balance').eq('id', sale.customer_id).single();
        if (cust) await supabase.from('customers').update({ balance: Math.max(0, remaining) }).eq('id', sale.customer_id);
        if (newPaid > 0) {
          await supabase.from('customer_payments').insert({
            customer_id: sale.customer_id, customer_name: sale.customer_name,
            amount: newPaid, type: 'تسوية يومية', notes: 'تسوية آخر اليوم',
            payment_date: selectedDate, payment_method: entry.method,
            sale_id: sale.id,
          });
        }
      }
      return sale.id;
    },
    onSuccess: (saleId) => {
      setSettled(prev => [...prev, saleId]);
      qc.invalidateQueries({ queryKey: ['settlement-sales', selectedDate] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['daily-cpayments'] });
      interact('success');
      toast.success('تمت التسوية بنجاح');
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ─── Mutation: تسوية جميع الفواتير دفعة واحدة ─── */
  const settleAllMutation = useMutation({
    mutationFn: async () => {
      for (const sale of pendingSales) {
        if (settled.includes(sale.id)) continue;
        const entry = getEntry(sale.id, sale.total_amount);
        const newPaid = Math.min(sale.total_amount, Math.max(0, entry.paid));
        const remaining = sale.total_amount - newPaid;
        const finalStatus = newPaid >= sale.total_amount ? 'كاملة' : newPaid > 0 ? 'جزئي' : 'مؤجلة';
        await supabase.from('sales').update({
          paid_amount: newPaid, initial_paid_amount: newPaid,
          status: finalStatus, payment_method: entry.method,
          wallet_from: entry.method === 'محفظة' ? entry.walletFrom : null,
          wallet_to: entry.method === 'محفظة' ? entry.walletTo : null,
        }).eq('id', sale.id);
        if (sale.customer_id && newPaid > 0) {
          const { data: cust } = await supabase.from('customers').select('balance').eq('id', sale.customer_id).single();
          if (cust) await supabase.from('customers').update({ balance: Math.max(0, remaining) }).eq('id', sale.customer_id);
          await supabase.from('customer_payments').insert({
            customer_id: sale.customer_id, customer_name: sale.customer_name,
            amount: newPaid, type: 'تسوية يومية', notes: 'تسوية آخر اليوم',
            payment_date: selectedDate, payment_method: entry.method, sale_id: sale.id,
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlement-sales', selectedDate] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['daily-cpayments'] });
      interact('success');
      toast.success(`تمت تسوية ${pendingSales.length} فاتورة بنجاح`);
      setSettled(pendingSales.map(s => s.id));
      setEntries({});
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const remaining = pendingSales.filter(s => !settled.includes(s.id));
  const totalRemaining = remaining.reduce((s: number, x: any) => s + x.total_amount, 0);

  const quickDates = [
    { label: 'اليوم', date: today() },
    { label: 'أمس', date: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })() },
  ];

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">تسوية مبيعات اليوم</h1>
            <p className="text-xs text-slate-400 mt-0.5">معالجة الفواتير المعلقة والمؤجلة وتحديث الخزينة</p>
          </div>
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input type="date" value={selectedDate} onChange={e => { setSelectedDate(e.target.value); setSettled([]); setEntries({}); }}
            className="border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-orange-400 bg-white" />
          {quickDates.map(b => (
            <button key={b.label} onClick={() => { setSelectedDate(b.date); setSettled([]); setEntries({}); }}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                selectedDate === b.date ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-500 border-slate-200 hover:border-orange-300')}>
              {b.label}
            </button>
          ))}
          <button onClick={() => refetch()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-medium border border-slate-200 transition-all">
            <RefreshCw className="w-3 h-3" />تحديث
          </button>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'فواتير معلقة', val: remaining.length, cls: 'border-orange-200 bg-orange-50', text: 'text-orange-700' },
          { label: 'إجمالي المبالغ', val: EGP(totalRemaining), cls: 'border-red-200 bg-red-50', text: 'text-red-700' },
          { label: 'تم تسويتها', val: settled.length, cls: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700' },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-3 border ${s.cls}`}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-lg font-black ${s.text} break-all`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* ── Global settle button ── */}
      {remaining.length > 1 && (
        <button
          className="w-full flex items-center justify-center gap-2 py-3 text-white font-bold rounded-2xl text-sm transition-all"
          style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}
          onClick={() => settleAllMutation.mutate()}
          disabled={settleAllMutation.isPending}>
          <CheckCircle2 className="w-5 h-5" />
          {settleAllMutation.isPending ? 'جاري التسوية...' : `تسوية جميع الفواتير (${remaining.length}) بالإعدادات الحالية`}
        </button>
      )}

      {/* ── Invoice list ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <div className="w-8 h-8 rounded-xl bg-orange-500 animate-pulse" />
        </div>
      ) : pendingSales.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center py-20 text-slate-400">
          <CheckCircle2 className="w-14 h-14 mb-3 opacity-20" />
          <p className="font-bold text-slate-500 text-lg">لا توجد فواتير معلقة</p>
          <p className="text-sm mt-1">في تاريخ {selectedDate}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingSales.map((sale: any) => {
            const isSettled = settled.includes(sale.id);
            const entry = getEntry(sale.id, sale.total_amount);
            const isExpanded = expandedId === sale.id;
            const cfg = STATUS_CONFIG[sale.status] || STATUS_CONFIG['معلقة'];

            return (
              <div key={sale.id}
                className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden transition-all',
                  isSettled ? 'border-emerald-300 opacity-60' : 'border-slate-200')}>

                {/* Card header */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                      isSettled ? 'bg-emerald-500' : 'bg-orange-500')}>
                      {isSettled ? <CheckCircle2 className="w-5 h-5 text-white" /> : <Clock className="w-5 h-5 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{sale.customer_name || 'عميل نقدي'}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400">{sale.sale_date}</span>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-semibold border', cfg.className)}>{cfg.label}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className="font-black text-emerald-600">{EGP(sale.total_amount)}</p>
                      {sale.paid_amount > 0 && sale.paid_amount < sale.total_amount && (
                        <p className="text-xs text-slate-400">مدفوع: {EGP(sale.paid_amount)}</p>
                      )}
                    </div>
                    {!isSettled && (
                      <button onClick={() => setExpandedId(isExpanded ? null : sale.id)}
                        className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-200 flex items-center justify-center transition-all">
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Settle form */}
                {isExpanded && !isSettled && (
                  <div className="border-t border-slate-100 bg-orange-50/40 p-4 space-y-4">

                    {/* Amount */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">المبلغ المدفوع (ج.م)</label>
                        <input type="number" min={0} max={sale.total_amount}
                          value={entry.paid || ''}
                          onChange={e => setEntry(sale.id, { paid: Number(e.target.value) })}
                          className={INPUT} />
                        <p className="text-xs text-slate-400">الإجمالي: {EGP(sale.total_amount)}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-600">الحالة بعد التسوية</label>
                        <select value={entry.finalStatus}
                          onChange={e => setEntry(sale.id, { finalStatus: e.target.value })}
                          className={INPUT}>
                          <option value="تلقائي">تلقائي</option>
                          <option value="كاملة">كاملة</option>
                          <option value="مؤجلة">مؤجلة</option>
                          <option value="جزئي">جزئي</option>
                        </select>
                      </div>
                    </div>

                    {/* Payment method */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">طريقة الدفع</label>
                      <div className="flex gap-2">
                        {(['كاش', 'محفظة'] as const).map(m => (
                          <button key={m} type="button"
                            onClick={() => setEntry(sale.id, { method: m })}
                            className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold border transition-all',
                              entry.method === m
                                ? m === 'كاش' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                            {m === 'كاش' ? <Wallet className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}{m}
                          </button>
                        ))}
                      </div>
                      {entry.method === 'محفظة' && (
                        <div className="grid grid-cols-2 gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-blue-700 flex items-center gap-1"><Hash className="w-3 h-3" />من رقم</label>
                            <input type="text" value={entry.walletFrom}
                              onChange={e => setEntry(sale.id, { walletFrom: e.target.value })}
                              placeholder="01XXXXXXXXX"
                              className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-blue-400" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-blue-700 flex items-center gap-1"><Hash className="w-3 h-3" />إلى رقم</label>
                            <input type="text" value={entry.walletTo}
                              onChange={e => setEntry(sale.id, { walletTo: e.target.value })}
                              placeholder="01XXXXXXXXX"
                              className="bg-white border border-blue-200 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-blue-400" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-all"
                        onClick={() => settleSingleMutation.mutate(sale)}
                        disabled={settleSingleMutation.isPending}>
                        <CheckCircle2 className="w-4 h-4" />تسوية هذه الفاتورة
                      </button>
                      <button
                        className="flex items-center justify-center w-10 h-10 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 transition-all"
                        onClick={() => setExpandedId(null)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Settled indicator */}
                {isSettled && (
                  <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span className="text-xs text-emerald-700 font-semibold">تمت التسوية</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Settlement;
