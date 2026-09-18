import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Store, Package, ArrowLeft, X, Trash2, Edit2, ArrowLeftRight, Plus, MapPin, Phone, Hash, Settings } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
const INPUT = 'app-input';

interface ShowroomInvItem { id: string; product_id: string; product_name: string; quantity: number; last_updated: string; }
interface TransferItem { product_id: string; quantity: number; }

const ShowroomDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { interact } = useInteraction();
  const qc = useQueryClient();

  const [showTransfer, setShowTransfer] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([{ product_id: '', quantity: 1 }]);
  const [editForm, setEditForm] = useState({ name: '', location: '', phone: '', notes: '' });

  /* ── حوار تعديل الكمية (بديل عن أزرار +/-) ── */
  const [adjustItem, setAdjustItem] = useState<ShowroomInvItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<{ dir: 'add' | 'sub'; amount: number }>({ dir: 'add', amount: 1 });

  const { data: showroom, isLoading } = useQuery({
    queryKey: ['showroom-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('showrooms').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const { data: showroomInv = [] } = useQuery({
    queryKey: ['showroom-inv', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('showroom_inventory').select('*').eq('showroom_id', id!).order('product_name');
      return (data || []) as ShowroomInvItem[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,price,purchase_price', { column: 'name' }),
    staleTime: 60000,
  });

  const { data: invTotals = {} } = useQuery<Record<string, number>>({
    queryKey: ['products-inventory-totals'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('inventory', 'product_id, quantity');
      const totals: Record<string, number> = {};
      (data || []).forEach((r: any) => { totals[r.product_id] = (totals[r.product_id] || 0) + r.quantity; });
      return totals;
    },
    staleTime: 30000,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('showrooms').update(editForm).eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['showroom-detail', id] });
      qc.invalidateQueries({ queryKey: ['showrooms'] });
      interact('success'); toast.success('تم تحديث المعرض'); setShowEdit(false);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('showrooms').delete().eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['showrooms'] });
      interact('delete'); toast.success('تم حذف المعرض');
      navigate('/showrooms');
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const validItems = transferItems.filter(it => it.product_id && it.quantity > 0);
      if (validItems.length === 0) throw new Error('يرجى إضافة منتج واحد على الأقل');

      for (const item of validItems) {
        const available = invTotals[item.product_id] || 0;
        const prod = products.find((p: any) => p.id === item.product_id);
        if (!prod) throw new Error('منتج غير موجود');
        if (item.quantity > available) throw new Error(`"${prod.name}" — المتاح: ${available}`);

        const { data: invRows } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).order('quantity', { ascending: false });
        let remaining = item.quantity;
        for (const inv of (invRows || [])) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, inv.quantity);
          await supabase.from('inventory').update({ quantity: inv.quantity - deduct, last_updated: new Date().toISOString() }).eq('id', inv.id);
          remaining -= deduct;
        }

        const { data: existing } = await supabase.from('showroom_inventory').select('id, quantity').eq('showroom_id', id!).eq('product_id', item.product_id).maybeSingle();
        if (existing) {
          await supabase.from('showroom_inventory').update({ quantity: existing.quantity + item.quantity, last_updated: new Date().toISOString() }).eq('id', existing.id);
        } else {
          await supabase.from('showroom_inventory').insert({ showroom_id: id, product_id: item.product_id, product_name: prod.name, quantity: item.quantity });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['showroom-inv', id] });
      qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      qc.invalidateQueries({ queryKey: ['showroom-inv-totals'] });
      qc.invalidateQueries({ queryKey: ['all-showroom-inv'] });
      interact('success');
      toast.success(`تم نقل ${transferItems.filter(i => i.product_id).length} صنف`);
      setShowTransfer(false);
      setTransferItems([{ product_id: '', quantity: 1 }]);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  /* ── تنفيذ تعديل الكمية (من الحوار المؤكَّد) ── */
  const applyAdjust = async () => {
    if (!adjustItem) return;
    const delta = adjustDelta.dir === 'add' ? adjustDelta.amount : -adjustDelta.amount;
    const newQty = adjustItem.quantity + delta;
    if (newQty < 0) { toast.error('الكمية لا تكون سالبة'); return; }

    if (delta > 0) {
      const avail = invTotals[adjustItem.product_id] || 0;
      if (delta > avail) { toast.error(`المتاح في المخزن: ${avail}`); return; }
      const { data: invRows } = await supabase.from('inventory').select('id, quantity').eq('product_id', adjustItem.product_id).order('quantity', { ascending: false });
      let rem = delta;
      for (const inv of (invRows || [])) {
        if (rem <= 0) break;
        const deduct = Math.min(rem, inv.quantity);
        await supabase.from('inventory').update({ quantity: inv.quantity - deduct, last_updated: new Date().toISOString() }).eq('id', inv.id);
        rem -= deduct;
      }
    } else {
      const { data: wh } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (wh) {
        const { data: ex } = await supabase.from('inventory').select('id, quantity').eq('product_id', adjustItem.product_id).eq('warehouse_id', wh.id).maybeSingle();
        if (ex) await supabase.from('inventory').update({ quantity: ex.quantity + Math.abs(delta), last_updated: new Date().toISOString() }).eq('id', ex.id);
        else await supabase.from('inventory').insert({ product_id: adjustItem.product_id, warehouse_id: wh.id, quantity: Math.abs(delta) });
      }
    }
    await supabase.from('showroom_inventory').update({ quantity: newQty, last_updated: new Date().toISOString() }).eq('id', adjustItem.id);
    qc.invalidateQueries({ queryKey: ['showroom-inv', id] });
    qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
    toast.success('تم تحديث الكمية');
    setAdjustItem(null);
  };

  const removeItem = async (item: ShowroomInvItem) => {
    if (!confirm(`إرجاع "${item.product_name}" للمخزن؟`)) return;
    const { data: wh } = await supabase.from('warehouses').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (wh) {
      const { data: ex } = await supabase.from('inventory').select('id, quantity').eq('product_id', item.product_id).eq('warehouse_id', wh.id).maybeSingle();
      if (ex) await supabase.from('inventory').update({ quantity: ex.quantity + item.quantity, last_updated: new Date().toISOString() }).eq('id', ex.id);
      else await supabase.from('inventory').insert({ product_id: item.product_id, warehouse_id: wh.id, quantity: item.quantity });
    }
    await supabase.from('showroom_inventory').delete().eq('id', item.id);
    qc.invalidateQueries({ queryKey: ['showroom-inv', id] });
    qc.invalidateQueries({ queryKey: ['products-inventory-totals'] });
    interact('success'); toast.success('تم إرجاع المنتج للمخزن');
  };

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;
  if (!showroom) return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Store className="w-12 h-12 mb-3 opacity-25" /><p>لم يتم العثور على المعرض</p>
      <button className="mt-4 btn-primary" onClick={() => navigate('/showrooms')}>العودة</button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Back */}
      <button onClick={() => navigate('/showrooms')} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" />العودة للمعارض
      </button>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}>
            <Store className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-800">{showroom.name}</h1>
            {showroom.location && <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-1"><MapPin className="w-3.5 h-3.5" />{showroom.location}</div>}
            {showroom.phone && <div className="flex items-center gap-1.5 text-sm text-slate-400 mt-0.5"><Phone className="w-3.5 h-3.5" />{showroom.phone}</div>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-slate-400">الأصناف</p>
            <p className="font-black text-2xl text-gold-700">{showroomInv.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">الوحدات</p>
            <p className="font-bold text-lg text-emerald-600">{showroomInv.reduce((s, i) => s + i.quantity, 0).toLocaleString('ar-EG')}</p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold min-w-[120px]"
            onClick={() => { setTransferItems([{ product_id: '', quantity: 1 }]); setShowTransfer(true); }}>
            <ArrowLeftRight className="w-4 h-4" />نقل منتجات
          </button>
          <button
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50"
            onClick={() => { setEditForm({ name: showroom.name, location: showroom.location || '', phone: showroom.phone || '', notes: showroom.notes || '' }); setShowEdit(true); }}>
            <Edit2 className="w-4 h-4" />تعديل
          </button>
          <button
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100"
            onClick={() => { if (confirm(`حذف معرض "${showroom.name}"؟`)) deleteMutation.mutate(); }}>
            <Trash2 className="w-4 h-4" />حذف
          </button>
        </div>
      </div>

      {/* ── Inventory List ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <h2 className="font-bold text-slate-800">منتجات المعرض ({showroomInv.length})</h2>
          <p className="text-xs text-slate-400 mt-0.5">لتعديل الكمية أو إرجاع منتج، استخدم قائمة ⋮ بجانب كل صنف</p>
        </div>
        {showroomInv.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {showroomInv.map(item => {
              const prod = products.find((p: any) => p.id === item.product_id);
              const warehouseAvail = invTotals[item.product_id] || 0;
              return (
                <div key={item.id} className="px-5 py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{item.product_name}</p>
                      {prod && <p className="text-xs text-slate-400">سعر: {EGP(prod.price)} | مخزن: {warehouseAvail}</p>}
                    </div>
                  </div>

                  {/* عرض الكمية فقط — بدون أزرار +/- المباشرة */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-center">
                      <span className="font-black text-xl text-emerald-600 block">{item.quantity.toLocaleString('ar-EG')}</span>
                      <span className="text-xs text-slate-400">وحدة</span>
                    </div>
                    {/* زر التحكم في الكمية — يفتح Modal مباشرة */}
                    <button
                      type="button"
                      onClick={() => { interact('click'); setAdjustItem(item); setAdjustDelta({ dir: 'add', amount: 1 }); }}
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold-600 hover:bg-gold-700 text-white text-xs font-semibold transition-colors flex-shrink-0"
                    >
                      <Settings className="w-3.5 h-3.5" style={{ pointerEvents: 'none' }} />
                      <span style={{ pointerEvents: 'none' }}>التحكم</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Package className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">لا توجد منتجات في المعرض</p>
            <p className="text-xs mt-1">اضغط "نقل منتجات" لإضافة منتجات</p>
          </div>
        )}
      </div>

      {/* ── حوار تعديل الكمية (مؤكَّد) ── */}
      {adjustItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-gold-600 rounded-xl flex items-center justify-center">
                <Hash className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800">تعديل الكمية</h2>
                <p className="text-xs text-slate-400 truncate max-w-[200px]">{adjustItem.product_name}</p>
              </div>
              <button className="mr-auto w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center"
                onClick={() => setAdjustItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* الكمية الحالية */}
              <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between border border-slate-200">
                <span className="text-xs text-slate-500">الكمية الحالية في المعرض</span>
                <span className="font-black text-xl text-emerald-600">{adjustItem.quantity.toLocaleString('ar-EG')}</span>
              </div>
              {/* اتجاه التعديل */}
              <div className="flex gap-2">
                {(['add', 'sub'] as const).map(dir => (
                  <button key={dir} type="button"
                    onClick={() => setAdjustDelta(p => ({ ...p, dir }))}
                    className={cn('flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all',
                      adjustDelta.dir === dir
                        ? dir === 'add' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-red-500 text-white border-red-500'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                    {dir === 'add' ? '+ إضافة' : '− خصم'}
                  </button>
                ))}
              </div>
              {/* الكمية المراد إضافة/خصم */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">الكمية</label>
                <input type="number" min={1}
                  value={adjustDelta.amount || ''}
                  onChange={e => setAdjustDelta(p => ({ ...p, amount: Number(e.target.value) }))}
                  autoFocus className="app-input text-center text-lg font-bold" />
              </div>
              {adjustDelta.dir === 'add' && (
                <p className="text-xs text-blue-600 font-medium text-center">
                  متاح في المخزن الرئيسي: <strong>{invTotals[adjustItem.product_id] || 0}</strong>
                </p>
              )}
              {/* النتيجة المتوقعة */}
              <div className="bg-gold-50 rounded-xl p-3 flex items-center justify-between border border-gold-200">
                <span className="text-xs text-gold-600 font-medium">الكمية بعد التعديل</span>
                <span className={cn('font-black text-xl',
                  adjustDelta.dir === 'sub' && adjustDelta.amount > adjustItem.quantity ? 'text-red-500' : 'text-gold-700')}>
                  {adjustDelta.dir === 'add'
                    ? adjustItem.quantity + (adjustDelta.amount || 0)
                    : Math.max(0, adjustItem.quantity - (adjustDelta.amount || 0))}
                </span>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 btn-primary" onClick={applyAdjust}>تأكيد التعديل</button>
              <button className="flex-1 btn-secondary" onClick={() => setAdjustItem(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl animate-fade-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><ArrowLeftRight className="w-4 h-4 text-white" /></div>
                <div><h2 className="font-bold text-slate-800">نقل للمعرض</h2><p className="text-xs text-slate-400">{showroom.name}</p></div>
              </div>
              <button className="w-8 h-8 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center" onClick={() => setShowTransfer(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {transferItems.map((item, idx) => {
                  const avail = item.product_id ? (invTotals[item.product_id] || 0) : 0;
                  return (
                    <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex gap-2">
                        <select value={item.product_id}
                          onChange={e => setTransferItems(prev => prev.map((it, i) => i === idx ? { ...it, product_id: e.target.value } : it))}
                          className="flex-1 bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm text-slate-800 focus:outline-none focus:border-gold-400">
                          <option value="">— اختر منتجاً —</option>
                          {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({invTotals[p.id] || 0} متاح)</option>)}
                        </select>
                        {transferItems.length > 1 && (
                          <button className="w-8 h-8 bg-red-50 text-red-500 rounded-lg flex items-center justify-center border border-red-200"
                            onClick={() => setTransferItems(prev => prev.filter((_, i) => i !== idx))}>
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {item.product_id && (
                        <div className="flex gap-2 items-center">
                          <input type="number" min={1} max={avail} value={item.quantity || ''}
                            onChange={e => setTransferItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Number(e.target.value) } : it))}
                            placeholder="الكمية"
                            className="flex-1 bg-white border border-slate-200 rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-gold-400" />
                          <span className={cn('text-xs px-2.5 py-1.5 rounded-lg border font-medium flex-shrink-0',
                            avail === 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600')}>
                            متاح: {avail}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 text-slate-500 rounded-xl text-sm hover:bg-slate-50"
                onClick={() => setTransferItems(prev => [...prev, { product_id: '', quantity: 1 }])}>
                <Plus className="w-4 h-4" />إضافة منتج آخر
              </button>
              <div className="flex gap-3">
                <button className="flex-1 btn-primary" onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending}>
                  {transferMutation.isPending ? 'جاري النقل...' : 'نقل للمعرض'}
                </button>
                <button className="flex-1 btn-secondary" onClick={() => setShowTransfer(false)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
              <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"><Store className="w-4 h-4 text-white" /></div>
              <h2 className="font-bold text-slate-800">تعديل المعرض</h2>
            </div>
            <div className="p-6 space-y-3">
              {[{ label: 'اسم المعرض *', key: 'name' }, { label: 'الموقع', key: 'location' }, { label: 'الهاتف', key: 'phone' }, { label: 'ملاحظات', key: 'notes' }].map(({ label, key }) => (
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

export default ShowroomDetail;
