import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Search, Phone, MapPin, Upload, Download, Edit2, Trash2, X, PhoneCall, ShieldAlert, AlertCircle, Lock } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import type { Customer } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const INPUT = 'app-input';
const BTN_PRIMARY = 'btn-primary';
const BTN_SECONDARY = 'btn-secondary';

const Customers = () => {
  const { interact } = useInteraction();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canCreate = can(role, 'customers:create');
  const canEdit   = can(role, 'customers:edit');
  const canDelete = can(role, 'customers:delete');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', notes: '', max_debt_limit: 0, balance: 0 });
  const [showForm, setShowForm] = useState(false);
  const [importProgress, setImportProgress] = useState<{ active: boolean; current: number; total: number }>({ active: false, current: 0, total: 0 });
  const emptyForm = { name: '', phone: '', location: '', notes: '', max_debt_limit: 0, initial_balance: 0 };
  const [form, setForm] = useState(emptyForm);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => fetchAllRows<Customer>('customers', '*', { column: 'name' }),
    staleTime: 30000,
  });

  const addMutation = useMutation({
    mutationFn: async (p: typeof emptyForm) => {
      const { initial_balance, ...rest } = p;
      const { error } = await supabase.from('customers').insert({
        ...rest,
        balance: Number(initial_balance) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); interact('success'); toast.success('تم إضافة العميل'); setShowForm(false); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof editForm }) => {
      const { error } = await supabase.from('customers').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); interact('success'); toast.success('تم تحديث بيانات العميل'); setEditItem(null); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('customers').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); interact('delete'); toast.success('تم حذف العميل'); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const rawLines = text.split('\n').slice(1).filter(l => l.trim());
      if (rawLines.length === 0) { toast.error('الملف فارغ أو غير صحيح'); return; }
      setImportProgress({ active: true, current: 0, total: rawLines.length });
      let count = 0;
      for (let idx = 0; idx < rawLines.length; idx++) {
        const cols = rawLines[idx].split(',');
        const name = cols[0]?.trim().replace(/^"|"$/g, '');
        if (!name) { setImportProgress(p => ({ ...p, current: idx + 1 })); continue; }
        const { error } = await supabase.from('customers').insert({
          name, phone: cols[1]?.trim().replace(/^"|"$/g, '') || '',
          location: cols[2]?.trim().replace(/^"|"$/g, '') || '',
          notes: cols[3]?.trim().replace(/^"|"$/g, '') || '',
          balance: Number(cols[4]?.trim().replace(/^"|"$/g, '')) || 0
        });
        if (!error) count++;
        setImportProgress(p => ({ ...p, current: idx + 1 }));
      }
      setImportProgress({ active: false, current: 0, total: 0 });
      qc.invalidateQueries({ queryKey: ['customers'] });
      interact('success'); toast.success(`تم استيراد ${count} عميل`);
    };
    reader.readAsText(file, 'UTF-8'); e.target.value = '';
  };

  const handleExport = () => {
    interact('click');
    const csv = '\uFEFF' + 'الاسم,الهاتف,الموقع,الملاحظات,الرصيد\n' +
      customers.map(c => [c.name, c.phone || '', c.location || '', c.notes || '', c.balance || 0].map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `عملاء.csv`; a.click();
    toast.success('تم تحميل ملف العملاء');
  };

  const filtered = customers.filter(c => c.name.includes(search) || (c.phone || '').includes(search));

  // عرض دفعات (60 عميل في المرة) بدل رندر الكل مرة واحدة، عشان الصفحة متلجش لو العملاء بالآلاف
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, customers.length]);
  const visible = filtered.slice(0, visibleCount);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(v => Math.min(v + PAGE_SIZE, filtered.length));
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);
  const totalDebt = customers.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'إجمالي العملاء', val: customers.length, cls: 'border-blue-100 bg-blue-50/60', text: 'text-blue-700' },
          { label: 'إجمالي المديونيات', val: EGP(totalDebt), cls: 'border-red-100 bg-red-50/60', text: 'text-red-700' },
          { label: 'عملاء بمديونية', val: customers.filter(c => c.balance > 0).length, cls: 'border-amber-100 bg-amber-50/60', text: 'text-amber-700' },
        ].map((s, i) => (
          <div key={i} className={`stat-card border ${s.cls}`}>
            <p className="text-xs text-slate-500 mb-1.5">{s.label}</p>
            <p className={`text-xl font-bold ${s.text} break-all`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث بالاسم أو الهاتف..." value={search} onChange={e => setSearch(e.target.value)} className="app-input pr-10" />
        </div>
        <button className={BTN_SECONDARY} onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" /><span className="hidden sm:inline">استيراد</span></button>
        <button className={BTN_SECONDARY} onClick={handleExport}><Download className="w-4 h-4" /><span className="hidden sm:inline">تصدير</span></button>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportExcel} />
        {canCreate && (
          <button className={BTN_PRIMARY} onClick={() => { interact('add'); setForm(emptyForm); setShowForm(true); }}>
            <Plus className="w-4 h-4" /><span>إضافة عميل</span>
          </button>
        )}
      </div>

      {/* Cards — clicking navigates to full page */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((customer, i) => (
          <div key={customer.id}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-fade-up"
            style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
          >
            <div className="p-4 cursor-pointer" onClick={() => { interact('click'); navigate(`/customers/${customer.id}`); }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-base">{customer.name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-800">{customer.name}</p>
                    {customer.phone && <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5"><Phone className="w-3 h-3" /><span dir="ltr">{customer.phone}</span></div>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border',
                    customer.balance > 0 ? 'bg-red-50 text-red-600 border-red-200' : customer.balance < 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                    {customer.balance > 0 ? 'مديون' : customer.balance < 0 ? 'دائن' : 'سوا'}
                  </span>
                  <p className={cn('font-bold text-sm mt-1', customer.balance > 0 ? 'text-red-600' : customer.balance < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                    {EGP(Math.abs(customer.balance))}
                  </p>
                  {(customer as any).max_debt_limit > 0 && customer.balance >= (customer as any).max_debt_limit && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-red-600 font-bold">
                      <ShieldAlert className="w-3 h-3" />تجاوز الحد
                    </div>
                  )}
                </div>
              </div>
              {customer.location && <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2"><MapPin className="w-3 h-3" /><span>{customer.location}</span></div>}
              {(customer as any).max_debt_limit > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
                  <ShieldAlert className="w-3 h-3" /><span>حد الائتمان: <span className="font-semibold text-slate-600">{EGP((customer as any).max_debt_limit)}</span></span>
                </div>
              )}
            </div>
            <div className="px-4 pb-4 flex items-center gap-1">
              {customer.phone && (
                <a href={`tel:${customer.phone}`}
                  className="flex items-center gap-1 py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 text-xs font-medium transition-all"
                  onClick={e => e.stopPropagation()}>
                  <PhoneCall className="w-3 h-3" /><span>اتصال</span>
                </a>
              )}
              <div className="flex-1 flex justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => { interact('click'); setEditItem(customer); setEditForm({ name: customer.name, phone: customer.phone || '', location: customer.location || '', notes: customer.notes || '', max_debt_limit: (customer as any).max_debt_limit || 0, balance: customer.balance || 0 }); }}
                    title="تعديل"
                    style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors flex-shrink-0"
                  >
                    <Edit2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                  </button>
                ) : (
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="تعديل العملاء للمديرين فقط"><Lock className="w-3.5 h-3.5" /></div>
                )}
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => { if (confirm('هل تريد حذف هذا العميل؟')) deleteMutation.mutate(customer.id); }}
                    title="حذف"
                    style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                  </button>
                ) : (
                  <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="حذف العملاء لمدير النظام فقط"><Lock className="w-3.5 h-3.5" /></div>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
            <Users className="w-12 h-12 mb-3 opacity-25" />
            <p className="text-sm font-medium">لا توجد عملاء</p>
          </div>
        )}
      </div>
      {visibleCount < filtered.length && (
        <div ref={loadMoreRef} className="flex justify-center py-4">
          <span className="text-xs text-slate-400">جاري تحميل المزيد… ({visibleCount} من {filtered.length})</span>
        </div>
      )}

      {/* Import Progress */}
      {importProgress.active && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center">
            <Upload className="w-10 h-10 text-slate-800 mx-auto mb-3 animate-bounce" />
            <p className="font-bold text-slate-800 mb-1">جاري الاستيراد...</p>
            <p className="text-sm text-slate-500 mb-4">{importProgress.current} من {importProgress.total}</p>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full transition-all" style={{ width: `${(importProgress.current / importProgress.total) * 100}%`, background: 'linear-gradient(90deg,#1e293b,#475569)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Users className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">تعديل بيانات العميل</h2>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center" onClick={() => setEditItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم العميل *', key: 'name', placeholder: 'اسم العميل' }, { label: 'رقم الهاتف', key: 'phone', placeholder: 'رقم التواصل' }, { label: 'الموقع', key: 'location', placeholder: 'العنوان' }, { label: 'ملاحظات', key: 'notes', placeholder: 'ملاحظات' }].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(editForm[key as keyof typeof editForm])} onChange={e => setEditForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className={INPUT} />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">حد الائتمان الأقصى (ج.م)</label>
                <input type="number" value={(editForm.max_debt_limit)||''} onChange={e => setEditForm(p => ({ ...p, max_debt_limit: Number(e.target.value) }))} placeholder="0 = بلا حد" className={INPUT} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  رصيد المديونية الحالي (ج.م)
                </label>
                <input type="number" value={editForm.balance || ''} onChange={e => setEditForm(p => ({ ...p, balance: Number(e.target.value) }))} placeholder="0" className={INPUT} />
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  موجب = مديون للمحل | سالب = دائن (له فلوس عندك)
                </p>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className={cn(BTN_PRIMARY, 'flex-1')} onClick={() => { if (!editForm.name) { toast.error('يرجى إدخال الاسم'); return; } updateMutation.mutate({ id: editItem.id, payload: editForm }); }} disabled={updateMutation.isPending}>حفظ التعديلات</button>
              <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => setEditItem(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Users className="w-4 h-4 text-white" /></div>
              <h2 className="text-base font-bold text-slate-800">إضافة عميل جديد</h2>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم العميل *', key: 'name', placeholder: 'أدخل اسم العميل' }, { label: 'رقم الهاتف', key: 'phone', placeholder: 'رقم التواصل' }, { label: 'الموقع', key: 'location', placeholder: 'العنوان' }, { label: 'ملاحظات', key: 'notes', placeholder: 'ملاحظات إضافية' }].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(form[key as keyof typeof form])} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className={INPUT} />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">حد الائتمان الأقصى (ج.م)</label>
                <input type="number" value={(form.max_debt_limit)||''} onChange={e => setForm(p => ({ ...p, max_debt_limit: Number(e.target.value) }))} placeholder="0 = بلا حد" className={INPUT} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  مديونية ابتدائية (ج.م)
                </label>
                <input type="number" value={form.initial_balance || ''} onChange={e => setForm(p => ({ ...p, initial_balance: Number(e.target.value) }))} placeholder="0" className={INPUT} />
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                  أدخل مبلغ المديونية المستحقة عليه — موجب = مدين | سالب = دائن
                </p>
              </div>

            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className={cn(BTN_PRIMARY, 'flex-1')} onClick={() => { if (!form.name) { toast.error('يرجى إدخال الاسم'); return; } addMutation.mutate(form); }} disabled={addMutation.isPending}>إضافة</button>
              <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
