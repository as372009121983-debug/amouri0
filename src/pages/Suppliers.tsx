import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, Search, Phone, MapPin, Upload, ChevronRight, Edit2, Trash2, X, Lock } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Supplier } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/permissions';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const INPUT = 'app-input';
const BTN_PRIMARY = 'btn-primary';
const BTN_SECONDARY = 'btn-secondary';

const Suppliers = () => {
  const { interact } = useInteraction();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role || 'worker';
  const canCreate = can(role, 'suppliers:create');
  const canEdit   = can(role, 'suppliers:edit');
  const canDelete = can(role, 'suppliers:delete');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<Supplier | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', location: '', notes: '', balance: 0 });
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { name: '', phone: '', location: '', notes: '', initial_balance: 0 };
  const [form, setForm] = useState(emptyForm);
  const [importProgress, setImportProgress] = useState<{ active: boolean; current: number; total: number }>({ active: false, current: 0, total: 0 });

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => { const { data, error } = await supabase.from('suppliers').select('*').order('name'); if (error) throw error; return data as Supplier[]; },
    staleTime: 30000,
  });

  const addMutation = useMutation({
    mutationFn: async (p: typeof emptyForm) => {
      const { initial_balance, ...rest } = p;
      const { error } = await supabase.from('suppliers').insert({ ...rest, balance: Number(initial_balance) || 0 });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); interact('success'); toast.success('تم إضافة المورد'); setShowForm(false); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof editForm }) => {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); interact('success'); toast.success('تم تحديث بيانات المورد'); setEditItem(null); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('suppliers').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); interact('delete'); toast.success('تم حذف المورد'); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
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
        const { error } = await supabase.from('suppliers').insert({
          name, phone: cols[1]?.trim().replace(/^"|"$/g, '') || '',
          location: cols[2]?.trim().replace(/^"|"$/g, '') || '',
          notes: cols[3]?.trim().replace(/^"|"$/g, '') || '',
          balance: Number(cols[4]?.trim().replace(/^"|"$/g, '')) || 0,
        });
        if (!error) count++;
        setImportProgress(p => ({ ...p, current: idx + 1 }));
      }
      setImportProgress({ active: false, current: 0, total: 0 });
      qc.invalidateQueries({ queryKey: ['suppliers'] }); interact('success'); toast.success(`تم استيراد ${count} مورد`);
    };
    reader.readAsText(file, 'UTF-8'); e.target.value = '';
  };

  const filtered = suppliers.filter(s => s.name.includes(search) || (s.phone || '').includes(search));
  const totalOwed = suppliers.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'إجمالي الموردين', val: suppliers.length, border: 'border-blue-200', bg: 'bg-blue-50', text: 'text-blue-700' },
          { label: 'مستحق للموردين', val: EGP(totalOwed), border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700' },
          { label: 'موردون برصيد', val: suppliers.filter(s => s.balance > 0).length, border: 'border-red-200', bg: 'bg-red-50', text: 'text-red-700' },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-4 border ${s.border} ${s.bg}`}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
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
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportExcel} />
        {canCreate && (
          <button className={BTN_PRIMARY} onClick={() => { interact('add'); setForm(emptyForm); setShowForm(true); }}>
            <Plus className="w-4 h-4" /><span>إضافة مورد</span>
          </button>
        )}
      </div>

      {/* Cards — clicking navigates to full page */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((supplier, i) => (
          <div key={supplier.id}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-fade-up cursor-pointer"
            style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
            onClick={() => { interact('click'); navigate(`/suppliers/${supplier.id}`); }}>
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-slate-700 rounded-xl flex items-center justify-center flex-shrink-0"><Truck className="w-5 h-5 text-white" /></div>
                  <div>
                    <p className="font-bold text-sm text-slate-800">{supplier.name}</p>
                    {supplier.phone && <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5"><Phone className="w-3 h-3" /><span dir="ltr">{supplier.phone}</span></div>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border', supplier.balance > 0 ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200')}>
                    {supplier.balance > 0 ? 'مستحق' : 'سوا'}
                  </span>
                  <p className={cn('font-bold text-sm mt-1', supplier.balance > 0 ? 'text-amber-600' : 'text-emerald-600')}>{EGP(Math.abs(supplier.balance))}</p>
                </div>
              </div>
              {supplier.location && <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2"><MapPin className="w-3 h-3" /><span>{supplier.location}</span></div>}
                <div className="flex justify-end gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => { interact('click'); setEditItem(supplier); setEditForm({ name: supplier.name, phone: supplier.phone || '', location: supplier.location || '', notes: supplier.notes || '', balance: supplier.balance || 0 }); }}
                      title="تعديل"
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors flex-shrink-0"
                    >
                      <Edit2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                    </button>
                  ) : (
                    <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="تعديل الموردين للمديرين فقط"><Lock className="w-3.5 h-3.5" /></div>
                  )}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => { if (confirm('هل تريد حذف هذا المورد؟')) deleteMutation.mutate(supplier.id); }}
                      title="حذف"
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" style={{ pointerEvents: 'none' }} />
                    </button>
                  ) : (
                    <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 text-slate-300 flex-shrink-0" title="حذف الموردين لمدير النظام فقط"><Lock className="w-3.5 h-3.5" /></div>
                  )}
                </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
            <Truck className="w-12 h-12 mb-3 opacity-25" />
            <p className="text-sm font-medium">لا توجد موردين</p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Truck className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">تعديل بيانات المورد</h2>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center" onClick={() => setEditItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم المورد *', key: 'name', placeholder: 'اسم المورد' }, { label: 'رقم الهاتف', key: 'phone', placeholder: 'رقم التواصل' }, { label: 'الموقع', key: 'location', placeholder: 'العنوان' }, { label: 'ملاحظات', key: 'notes', placeholder: 'ملاحظات' }].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(editForm[key as keyof typeof editForm])} onChange={e => setEditForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className={INPUT} />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">رصيد المديونية الحالي (ج.م)</label>
                <input type="number" value={editForm.balance || ''} onChange={e => setEditForm(p => ({ ...p, balance: Number(e.target.value) }))} placeholder="0" className={INPUT} />
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">موجب = مستحق للمورد | سالب = المحل دائن</p>
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
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Truck className="w-4 h-4 text-white" /></div>
              <h2 className="text-base font-bold text-slate-800">إضافة مورد جديد</h2>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم المورد *', key: 'name', placeholder: 'أدخل اسم المورد' }, { label: 'رقم الهاتف', key: 'phone', placeholder: 'رقم التواصل' }, { label: 'الموقع / العنوان', key: 'location', placeholder: 'العنوان' }, { label: 'ملاحظات', key: 'notes', placeholder: 'ملاحظات إضافية' }].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(form[key as keyof typeof form])} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className={INPUT} />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">مديونية ابتدائية (ج.م)</label>
                <input type="number" value={form.initial_balance || ''} onChange={e => setForm(p => ({ ...p, initial_balance: Number(e.target.value) }))} placeholder="0" className={INPUT} />
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">مبلغ مستحق للمورد من قبل إضافته للنظام</p>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className={cn(BTN_PRIMARY, 'flex-1')} onClick={() => { if (!form.name) { toast.error('يرجى إدخال الاسم'); return; } addMutation.mutate(form); }} disabled={addMutation.isPending}>إضافة</button>
              <button className={cn(BTN_SECONDARY, 'flex-1')} onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
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
    </div>
  );
};

export default Suppliers;
