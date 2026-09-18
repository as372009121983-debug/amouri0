import { Store, Plus, Package, ArrowRight, X, Search, Upload, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';

const BTN_PRIMARY = 'btn-primary';
const BTN_SECONDARY = 'btn-secondary';
const INPUT = 'app-input';

interface Showroom { id: string; name: string; location?: string; phone?: string; notes?: string; created_at: string; }
interface ShowroomInvItem { id: string; product_id: string; product_name: string; quantity: number; last_updated: string; }

const Showrooms = () => {
  const { interact } = useInteraction();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const showroomsFileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<{ active: boolean; current: number; total: number }>({ active: false, current: 0, total: 0 });
  const emptyForm = { name: '', location: '', phone: '', notes: '' };
  const [form, setForm] = useState(emptyForm);

  const { data: showrooms = [], isLoading } = useQuery({
    queryKey: ['showrooms'],
    queryFn: async () => {
      const { data, error } = await supabase.from('showrooms').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Showroom[];
    },
    staleTime: 30000,
  });

  const { data: allShowroomInv = [] } = useQuery({
    queryKey: ['all-showroom-inv'],
    queryFn: async () => {
      return fetchAllRows<ShowroomInvItem>('showroom_inventory', '*', undefined, (q) => q.gt('quantity', 0));
    },
    staleTime: 30000,
  });

  const { data: showroomCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['showroom-item-counts'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('showroom_inventory', 'showroom_id, quantity', undefined, (q) => q.gt('quantity', 0));
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => { counts[r.showroom_id] = (counts[r.showroom_id] || 0) + 1; });
      return counts;
    },
    staleTime: 30000,
  });

  const { data: showroomTotalQty = {} } = useQuery<Record<string, number>>({
    queryKey: ['showroom-total-qty'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('showroom_inventory', 'showroom_id, quantity');
      const totals: Record<string, number> = {};
      (data || []).forEach((r: any) => { totals[r.showroom_id] = (totals[r.showroom_id] || 0) + r.quantity; });
      return totals;
    },
    staleTime: 30000,
  });

  const addMutation = useMutation({
    mutationFn: async (payload: typeof emptyForm) => {
      const { error } = await supabase.from('showrooms').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['showrooms'] }); interact('success'); toast.success('تم إضافة المعرض'); setShowForm(false); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const rawLines = (ev.target?.result as string).split('\n').slice(1).filter(l => l.trim());
      if (!rawLines.length) { toast.error('الملف فارغ'); return; }
      setImportProgress({ active: true, current: 0, total: rawLines.length });
      let count = 0;
      for (let i = 0; i < rawLines.length; i++) {
        const cols = rawLines[i].split(',');
        const name = cols[0]?.trim().replace(/^"|"$/g, '');
        if (!name) { setImportProgress(p => ({ ...p, current: i + 1 })); continue; }
        const { error } = await supabase.from('showrooms').insert({ name, location: cols[1]?.trim().replace(/^"|"$/g, '') || '', phone: cols[2]?.trim().replace(/^"|"$/g, '') || '', notes: cols[3]?.trim().replace(/^"|"$/g, '') || '' });
        if (!error) count++;
        setImportProgress(p => ({ ...p, current: i + 1 }));
      }
      setImportProgress({ active: false, current: 0, total: 0 });
      qc.invalidateQueries({ queryKey: ['showrooms'] });
      toast.success(`تم استيراد ${count} معرض`);
    };
    reader.readAsText(file, 'UTF-8'); e.target.value = '';
  };

  const productSearchResults = productSearch.trim().length > 0 ? (() => {
    const lc = productSearch.toLowerCase();
    const matched = allShowroomInv.filter(it => it.product_name.toLowerCase().includes(lc));
    const grouped: Record<string, { productName: string; showrooms: { name: string; qty: number }[] }> = {};
    for (const item of matched) {
      const sr = showrooms.find(s => s.id === (item as any).showroom_id);
      if (!sr) continue;
      if (!grouped[item.product_name]) grouped[item.product_name] = { productName: item.product_name, showrooms: [] };
      grouped[item.product_name].showrooms.push({ name: sr.name, qty: item.quantity });
    }
    return Object.values(grouped);
  })() : [];

  const filtered = showrooms.filter(s => s.name.includes(search));

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card border border-blue-100 bg-blue-50/60"><p className="text-xs text-slate-500 mb-1.5">إجمالي المعارض</p><p className="text-2xl font-bold text-blue-700">{showrooms.length}</p></div>
        <div className="stat-card border border-emerald-100 bg-emerald-50/60"><p className="text-xs text-slate-500 mb-1.5">أصناف في المعارض</p><p className="text-2xl font-bold text-emerald-700">{Object.values(showroomCounts).reduce((s, v) => s + v, 0)}</p></div>
        <div className="stat-card border border-violet-100 bg-violet-50/60"><p className="text-xs text-slate-500 mb-1.5">إجمالي الوحدات</p><p className="text-2xl font-bold text-violet-700">{Object.values(showroomTotalQty).reduce((s, v) => s + v, 0).toLocaleString('ar-EG')}</p></div>
      </div>

      {/* Product Search */}
      <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
        <button className="w-full flex items-center justify-between px-5 py-4" onClick={() => setShowProductSearch(v => !v)}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)' }}>
              <Search className="w-4 h-4 text-white" />
            </div>
            <div className="text-right">
              <p className="font-bold text-slate-800 text-sm">البحث عن منتج في المعارض</p>
              <p className="text-xs text-slate-400">ابحث عن أي منتج لمعرفة وجوده في أي معرض</p>
            </div>
          </div>
          {showProductSearch ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        {showProductSearch && (
          <div className="px-5 pb-5 border-t border-amber-100">
            <div className="relative mt-4 mb-4">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="اكتب اسم المنتج..." value={productSearch} onChange={e => setProductSearch(e.target.value)} autoFocus
                className="w-full bg-amber-50 border border-amber-200 rounded-xl py-2.5 pr-10 pl-4 text-sm focus:outline-none focus:border-amber-400" />
            </div>
            {productSearch.trim().length > 0 ? (
              productSearchResults.length === 0 ? (
                <div className="text-center py-6 text-slate-400"><Package className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">لا يوجد منتج بهذا الاسم في أي معرض</p></div>
              ) : (
                <div className="space-y-3">
                  {productSearchResults.map(result => (
                    <div key={result.productName} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0"><Package className="w-3.5 h-3.5 text-white" /></div>
                        <p className="font-bold text-slate-800">{result.productName}</p>
                        <span className="text-xs text-amber-600 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-lg">{result.showrooms.length} معرض</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {result.showrooms.map((sr, i) => (
                          <div key={i} className="flex items-center justify-between bg-white border border-amber-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2"><Store className="w-3.5 h-3.5 text-amber-500" /><span className="text-sm font-medium text-slate-700">{sr.name}</span></div>
                            <span className="font-bold text-emerald-600 text-sm">{sr.qty.toLocaleString('ar-EG')}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-amber-600 mt-2">الإجمالي: <strong>{result.showrooms.reduce((s, r) => s + r.qty, 0).toLocaleString('ar-EG')}</strong> وحدة</p>
                    </div>
                  ))}
                </div>
              )
            ) : <p className="text-xs text-slate-400 text-center py-4">ابدأ الكتابة للبحث في جميع المعارض</p>}
          </div>
        )}
      </div>

      {/* Import Progress */}
      {importProgress.active && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 text-center">
            <Upload className="w-10 h-10 text-slate-800 mx-auto mb-3 animate-bounce" />
            <p className="font-bold text-slate-800 mb-1">جاري الاستيراد...</p>
            <p className="text-sm text-slate-500 mb-4">{importProgress.current} من {importProgress.total}</p>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full" style={{ width: `${(importProgress.current / importProgress.total) * 100}%`, background: 'linear-gradient(90deg,#1e293b,#475569)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="البحث بالمعرض..." value={search} onChange={e => setSearch(e.target.value)} className="app-input pr-10" />
        </div>
        <button className={BTN_SECONDARY} onClick={() => showroomsFileInputRef.current?.click()}>
          <Upload className="w-4 h-4" /><span className="hidden sm:inline">استيراد CSV</span>
        </button>
        <input ref={showroomsFileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
        <button className={BTN_PRIMARY} onClick={() => { interact('add'); setForm(emptyForm); setShowForm(true); }}>
          <Plus className="w-4 h-4" /><span>إضافة معرض</span>
        </button>
      </div>

      {/* Grid — click navigates to full detail page */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((showroom, i) => {
          const itemCount = showroomCounts[showroom.id] || 0;
          const totalQty = showroomTotalQty[showroom.id] || 0;
          return (
            <div key={showroom.id}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-fade-up cursor-pointer"
              style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
              onClick={() => { interact('click'); navigate(`/showrooms/${showroom.id}`); }}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}>
                    <Store className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-right">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg font-medium block">{itemCount} صنف</span>
                    <span className="text-xs text-emerald-600 font-semibold mt-1 block">{totalQty.toLocaleString('ar-EG')} وحدة</span>
                  </div>
                </div>
                <h3 className="font-bold text-slate-800 text-base mb-1">{showroom.name}</h3>
                {showroom.location && <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1"><MapPin className="w-3 h-3 flex-shrink-0" /><span>{showroom.location}</span></div>}
                {showroom.phone && <p className="text-xs text-slate-400 mb-3">📞 {showroom.phone}</p>}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-xs text-[#a97a1f] font-medium">عرض المنتجات</span>
                  <ArrowRight className="w-4 h-4 text-[#a97a1f]" />
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
            <Store className="w-16 h-16 mb-3 opacity-20" />
            <p className="text-sm font-medium mb-1">لا توجد معارض</p>
            <p className="text-xs opacity-70">اضغط "إضافة معرض" للبدء</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Store className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">إضافة معرض جديد</h2>
              </div>
              <button className="w-8 h-8 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم المعرض *', key: 'name' }, { label: 'الموقع', key: 'location' }, { label: 'الهاتف', key: 'phone' }, { label: 'ملاحظات', key: 'notes' }].map(({ label, key }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <input type="text" value={String(form[key as keyof typeof form])} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={INPUT} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className={BTN_PRIMARY + ' flex-1'} onClick={() => { if (!form.name) { toast.error('يرجى إدخال اسم المعرض'); return; } addMutation.mutate(form); }} disabled={addMutation.isPending}>إضافة</button>
              <button className={BTN_SECONDARY + ' flex-1'} onClick={() => setShowForm(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Showrooms;
