import { useState, useMemo } from 'react';
import {
  Receipt, Plus, Edit2, Trash2, Search, Download,
  TrendingDown, Calendar, BarChart3, PieChart, Printer, Lock,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';
import { PieChart as RechartsPie, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { printUnifiedReport } from '@/lib/printInvoice';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 0 }) + ' ج.م';

const CATEGORIES = [
  'عام', 'إيجار', 'مواصلات', 'صيانة', 'تشغيل',
  'وقود', 'مشتريات إدارية', 'مرتبات', 'سلف عمال', 'أخرى',
];

const CAT_META: Record<string, { color: string; badge: string; hex: string }> = {
  'مرتبات':         { color: 'text-blue-700',   badge: 'bg-blue-50 border-blue-200 text-blue-700',     hex: '#3b82f6' },
  'سلف عمال':       { color: 'text-indigo-700',  badge: 'bg-indigo-50 border-indigo-200 text-indigo-700', hex: '#6366f1' },
  'إيجار':          { color: 'text-violet-700',  badge: 'bg-violet-50 border-violet-200 text-violet-700', hex: '#8b5cf6' },
  'مواصلات':        { color: 'text-cyan-700',    badge: 'bg-cyan-50 border-cyan-200 text-cyan-700',     hex: '#06b6d4' },
  'صيانة':          { color: 'text-amber-700',   badge: 'bg-amber-50 border-amber-200 text-amber-700',  hex: '#f59e0b' },
  'تشغيل':          { color: 'text-emerald-700', badge: 'bg-emerald-50 border-emerald-200 text-emerald-700', hex: '#10b981' },
  'وقود':           { color: 'text-orange-700',  badge: 'bg-orange-50 border-orange-200 text-orange-700', hex: '#f97316' },
  'مشتريات إدارية': { color: 'text-pink-700',    badge: 'bg-pink-50 border-pink-200 text-pink-700',    hex: '#ec4899' },
  'عام':            { color: 'text-slate-700',   badge: 'bg-slate-50 border-slate-200 text-slate-700',  hex: '#64748b' },
  'أخرى':           { color: 'text-rose-700',    badge: 'bg-rose-50 border-rose-200 text-rose-700',     hex: '#f43f5e' },
};

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  expense_date: string;
  created_at: string;
}

// ── Tiny tooltip for recharts ─────────────────────────────────────────────
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-sm">
      <p className="font-bold text-slate-800">{payload[0].name || payload[0].payload?.category}</p>
      <p className="text-slate-500">{EGP(payload[0].value)}</p>
    </div>
  );
};

const Expenses = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canCreate = can(role, 'expenses:create');
  const canEdit   = can(role, 'expenses:edit');
  const canDelete = can(role, 'expenses:delete');

  const [search, setSearch]               = useState('');
  const [filterCategory, setFilterCategory] = useState('الكل');
  const [filterMonth, setFilterMonth]     = useState('');
  const [chartMode, setChartMode]         = useState<'pie' | 'bar'>('pie');
  const [showForm, setShowForm]           = useState(false);
  const [editItem, setEditItem]           = useState<Expense | null>(null);

  const today    = new Date().toISOString().split('T')[0];
  const emptyForm = { description: '', amount: 0, category: 'عام', expense_date: today };
  const [form, setForm] = useState(emptyForm);

  // ── Query ─────────────────────────────────────────────────────────────────
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, description, amount, category, expense_date, created_at')
        .order('expense_date', { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (payload: typeof emptyForm) => {
      const { error } = await supabase.from('expenses').insert({ ...payload, created_by: profile?.id });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); interact('success'); toast.success('تم إضافة المصروف'); setShowForm(false); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof emptyForm }) => {
      const { error } = await supabase.from('expenses').update(payload).eq('id', id);
      if (error) throw error;
      // Sync worker transaction if applicable
      if (editItem && (editItem.category === 'مرتبات' || editItem.category === 'سلف عمال')) {
        const workerName = (editItem.description || '').replace(/^(مرتب: |سلفة: )/, '');
        if (workerName) {
          const { data: txns } = await supabase.from('worker_transactions')
            .select('id').eq('worker_name', workerName).eq('amount', editItem.amount).limit(1);
          if (txns && txns.length > 0)
            await supabase.from('worker_transactions').update({ amount: payload.amount }).eq('id', txns[0].id);
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['worker-transactions'] }); interact('success'); toast.success('تم التحديث'); setShowForm(false); setEditItem(null); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Sync worker transaction if applicable
      const expense = expenses.find(e => e.id === id);
      if (expense && (expense.category === 'مرتبات' || expense.category === 'سلف عمال')) {
        const workerName = (expense.description || '').replace(/^(مرتب: |سلفة: )/, '');
        if (workerName) {
          const { data: txns } = await supabase.from('worker_transactions')
            .select('id').eq('worker_name', workerName).eq('amount', expense.amount).limit(1);
          if (txns && txns.length > 0)
            await supabase.from('worker_transactions').delete().eq('id', txns[0].id);
        }
      }
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['worker-transactions'] }); interact('delete'); toast.success('تم الحذف'); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => expenses.filter(e => {
    const mS = e.description.includes(search) || e.category.includes(search);
    const mC = filterCategory === 'الكل' || e.category === filterCategory;
    const mM = !filterMonth || e.expense_date.startsWith(filterMonth);
    return mS && mC && mM;
  }), [expenses, search, filterCategory, filterMonth]);

  const thisMonth      = new Date().toISOString().slice(0, 7);
  const prevMonth      = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const thisMonthTotal = expenses.filter(e => e.expense_date.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
  const prevMonthTotal = expenses.filter(e => e.expense_date.startsWith(prevMonth)).reduce((s, e) => s + e.amount, 0);
  const filteredTotal  = filtered.reduce((s, e) => s + e.amount, 0);
  const monthGrowth    = prevMonthTotal > 0 ? ((thisMonthTotal - prevMonthTotal) / prevMonthTotal * 100).toFixed(1) : null;

  // Pie data
  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Bar data — last 6 months
  const barData = useMemo(() => {
    const months: { month: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const month = d.toISOString().slice(0, 7);
      const label = d.toLocaleString('ar-EG', { month: 'short' });
      const total = expenses.filter(e => e.expense_date.startsWith(month)).reduce((s, e) => s + e.amount, 0);
      months.push({ month, label, total });
    }
    return months;
  }, [expenses]);

  const topCategory = pieData[0]?.name || '—';

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const handleCSV = () => {
    interact('click');
    const headers = ['التاريخ', 'الوصف', 'الفئة', 'المبلغ'];
    const rows = filtered.map(e => [e.expense_date, e.description, e.category, String(e.amount)]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `expenses-${thisMonth}.csv`; a.click(); URL.revokeObjectURL(a.href);
    toast.success('تم تصدير المصروفات');
  };

  // ── Print ──────────────────────────────────────────────────────────────────
  const handlePrint = () => {
    interact('click');
    printUnifiedReport({
      title: 'تقرير المصروفات',
      subtitle: `${filterCategory !== 'الكل' ? filterCategory : 'كل الفئات'}`,
      dateRange: filterMonth || undefined,
      kpis: [
        { label: 'الإجمالي المعروض', value: EGP(filteredTotal) },
        { label: 'عدد السجلات', value: String(filtered.length) },
        { label: 'أكثر فئة إنفاقاً', value: topCategory },
        { label: 'هذا الشهر', value: EGP(thisMonthTotal) },
      ],
      columns: [
        { label: 'التاريخ', key: 'expense_date', align: 'right' },
        { label: 'الوصف', key: 'description', align: 'right' },
        { label: 'الفئة', key: 'category', align: 'right' },
        {
          label: 'المبلغ',
          key: 'amount',
          align: 'center',
          format: (v) => EGP(v),
          color: () => '#dc2626',
        },
      ],
      rows: filtered,
      footerCells: {
        expense_date: `${filtered.length} سجل`,
        description: '',
        category: 'الإجمالي',
        amount: EGP(filteredTotal),
      },
    });
  };

  // ── Save helper ────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!form.description || !form.amount) { interact('error'); toast.error('يرجى تعبئة الحقول المطلوبة'); return; }
    if (editItem) updateMutation.mutate({ id: editItem.id, payload: form });
    else addMutation.mutate(form);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 gradient-amber rounded-xl animate-pulse" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Hero Header ── */}
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}>
        <div className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-200" />
                <span className="text-xs text-red-200 font-medium">المصروفات والتكاليف</span>
              </div>
              <p className="text-2xl font-black text-white">{EGP(filteredTotal)}</p>
              <p className="text-xs text-red-200 mt-1">{filtered.length} سجل معروض</p>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-2 bg-white text-red-700 rounded-xl text-xs font-bold hover:bg-red-50 transition-all shadow-sm">
                <Printer className="w-3.5 h-3.5" /><span className="hidden sm:inline">طباعة</span>
              </button>
              {canCreate && (
                <button
                  className="flex items-center gap-1.5 px-4 py-2 bg-white text-red-700 rounded-xl text-xs font-bold hover:bg-red-50 transition-all shadow-sm"
                  onClick={() => { interact('add'); setEditItem(null); setForm(emptyForm); setShowForm(true); }}>
                  <Plus className="w-3.5 h-3.5" /><span>إضافة</span>
                </button>
              )}
            </div>
          </div>

          {/* Mini KPIs */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { label: 'هذا الشهر', value: EGP(thisMonthTotal) },
              { label: 'الشهر الماضي', value: EGP(prevMonthTotal) },
              { label: 'التغيير', value: monthGrowth !== null ? `${monthGrowth > '0' ? '+' : ''}${monthGrowth}%` : '—' },
            ].map(k => (
              <div key={k.label} className="bg-white/10 rounded-xl p-2.5 text-center">
                <p className="text-xs text-red-200">{k.label}</p>
                <p className="text-sm font-black text-white mt-0.5">{k.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-red-500" />
            <span className="font-bold text-sm text-slate-800">التحليل البياني</span>
          </div>
          <div className="flex gap-1">
            {[{ id: 'pie' as const, icon: PieChart, label: 'فئات' }, { id: 'bar' as const, icon: BarChart3, label: 'شهري' }].map(m => (
              <button key={m.id} onClick={() => setChartMode(m.id)}
                className={cn('flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                  chartMode === m.id ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                <m.icon className="w-3 h-3" />{m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          {chartMode === 'pie' && pieData.length > 0 ? (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <ResponsiveContainer width="100%" height={180} className="flex-shrink-0 sm:w-52">
                <RechartsPie>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40} paddingAngle={2}>
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={CAT_META[entry.name]?.hex || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </RechartsPie>
              </ResponsiveContainer>
              <div className="flex-1 grid grid-cols-2 gap-1.5 w-full">
                {pieData.slice(0, 8).map((d) => (
                  <div key={d.name} className="flex items-center justify-between bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: CAT_META[d.name]?.hex || '#64748b' }} />
                      <span className="text-xs text-slate-600 truncate max-w-20">{d.name}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-800">{EGP(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : chartMode === 'bar' ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" name="المصروفات" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">لا توجد بيانات</div>
          )}
        </div>
      </div>

      {/* ── Category Pills ── */}
      {pieData.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => { interact('click'); setFilterCategory('الكل'); }}
            className={cn('flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold border transition-all',
              filterCategory === 'الكل' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-slate-600 border-slate-200 hover:border-red-200')}>
            الكل
          </button>
          {pieData.map(d => (
            <button key={d.name} onClick={() => { interact('click'); setFilterCategory(filterCategory === d.name ? 'الكل' : d.name); }}
              className={cn('flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                filterCategory === d.name
                  ? 'text-white border-transparent'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300')}
              style={filterCategory === d.name ? { background: CAT_META[d.name]?.hex || '#64748b', borderColor: 'transparent' } : {}}>
              <span className="w-2 h-2 rounded-full" style={{ background: CAT_META[d.name]?.hex || '#64748b' }} />
              {d.name}
              <span className="font-normal opacity-75">({EGP(d.value)})</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-44">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث في المصروفات..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-10 pl-4 text-sm focus:outline-none focus:border-red-300 text-slate-800 placeholder:text-slate-400" />
        </div>
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="bg-transparent text-sm text-slate-600 focus:outline-none" />
        </div>
        {(search || filterMonth || filterCategory !== 'الكل') && (
          <button onClick={() => { setSearch(''); setFilterMonth(''); setFilterCategory('الكل'); }}
            className="px-3 py-2 bg-slate-100 text-slate-500 text-sm rounded-xl hover:bg-slate-200">مسح</button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: 'linear-gradient(135deg,#1e293b,#334155)' }}>
                {['التاريخ', 'الوصف', 'الفئة', 'المبلغ', 'إجراء'].map(h => (
                  <th key={h} className="text-right text-xs text-white px-4 py-3 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((expense, i) => {
                const meta = CAT_META[expense.category];
                return (
                  <tr key={expense.id}
                    className="border-b border-slate-50 hover:bg-red-50/30 transition-colors animate-fade-up"
                    style={{ animationDelay: `${Math.min(i, 15) * 35}ms` }}>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{expense.expense_date}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800">{expense.description}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-lg border font-medium', meta?.badge || 'bg-slate-50 border-slate-200 text-slate-600')}>
                        {expense.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-black text-red-500 whitespace-nowrap">{EGP(expense.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {canEdit ? (
                          <button className="w-7 h-7 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-500 rounded-lg flex items-center justify-center border border-slate-200 transition-all"
                            onClick={() => { interact('click'); setEditItem(expense); setForm({ description: expense.description, amount: expense.amount, category: expense.category, expense_date: expense.expense_date }); setShowForm(true); }}>
                            <Edit2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <div className="w-7 h-7 bg-slate-50 text-slate-200 rounded-lg flex items-center justify-center border border-slate-100" title="تعديل المصروفات للمديرين فقط"><Lock className="w-3 h-3" /></div>
                        )}
                        {canDelete ? (
                          <button className="w-7 h-7 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg flex items-center justify-center border border-slate-200 transition-all"
                            onClick={() => deleteMutation.mutate(expense.id)}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <div className="w-7 h-7 bg-slate-50 text-slate-200 rounded-lg flex items-center justify-center border border-slate-100" title="حذف المصروفات للمديرين فقط"><Lock className="w-3 h-3" /></div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <Receipt className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                    <p className="text-sm text-slate-400">لا توجد مصروفات مسجلة</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/50">
            <p className="text-xs text-slate-400">{filtered.length} سجل</p>
            <p className="text-sm font-black text-red-500">الإجمالي: {EGP(filteredTotal)}</p>
          </div>
        )}
      </div>

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100"
              style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}>
              <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
                <Receipt className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-base font-bold text-white">{editItem ? 'تعديل المصروف' : 'إضافة مصروف جديد'}</h2>
            </div>

            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">وصف المصروف *</label>
                <input type="text" value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="مثال: إيجار مخزن يناير"
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-red-300 text-slate-800" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">المبلغ (ج.م) *</label>
                  <input type="number" min={0} value={form.amount || ''}
                    onChange={e => setForm(p => ({ ...p, amount: Number(e.target.value) }))}
                    className="w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-red-300 text-slate-800" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">التاريخ</label>
                  <input type="date" value={form.expense_date}
                    onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-red-300 text-slate-800" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">الفئة</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {CATEGORIES.map(cat => (
                    <button key={cat} type="button"
                      onClick={() => setForm(p => ({ ...p, category: cat }))}
                      className={cn('py-1.5 px-2 rounded-xl text-xs font-medium border transition-all text-center',
                        form.category === cat
                          ? 'text-white border-transparent'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300')}
                      style={form.category === cat ? { background: CAT_META[cat]?.hex || '#64748b' } : {}}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <button
                className="flex-1 py-2.5 text-white rounded-xl font-bold text-sm hover:opacity-90 transition-all"
                style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}
                onClick={handleSave}
                disabled={addMutation.isPending || updateMutation.isPending}>
                {editItem ? 'حفظ التعديلات' : 'إضافة المصروف'}
              </button>
              <button
                className="flex-1 py-2.5 bg-slate-100 text-slate-500 rounded-xl font-medium text-sm hover:bg-slate-200 transition-all"
                onClick={() => { interact('click'); setShowForm(false); setEditItem(null); }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;
