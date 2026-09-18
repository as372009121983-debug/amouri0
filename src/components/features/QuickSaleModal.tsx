/**
 * QuickSaleModal — نموذج بيع سريع مبسط
 * يظهر كـ bottom-sheet على الجوال وـ modal على الديسكتوب
 * - اختيار منتج + كمية + سعر فقط
 * - عميل اختياري
 * - حالة تلقائية (نقدي / آجل)
 */
import { useState, useCallback } from 'react';
import { X, Plus, Trash2, Zap, Search } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useInteraction } from '@/hooks/useInteraction';

const EGP = (v: number) => v.toLocaleString('ar-EG', { minimumFractionDigits: 0 }) + ' ج.م';
const today = () => new Date().toISOString().split('T')[0];

interface QuickItem {
  _key: number;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string;
}

let _k = 0;

interface Props {
  onClose: () => void;
}

const QuickSaleModal = ({ onClose }: Props) => {
  const { interact } = useInteraction();
  const qc = useQueryClient();
  const [items, setItems] = useState<QuickItem[]>([{ _key: ++_k, product_id: '', product_name: '', quantity: 1, unit_price: 0, unit: '' }]);
  const [customerId, setCustomerId] = useState('');
  const [paidAmount, setPaidAmount] = useState(0);
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => fetchAllRows<any>('products', 'id,name,price,unit,min_sale_price,max_sale_price', { column: 'name' }),
    staleTime: 60000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => { const { data } = await supabase.from('customers').select('id,name,balance').order('name'); return (data || []) as any[]; },
    staleTime: 60000,
  });

  const { data: inventoryTotals = {} } = useQuery<Record<string, number>>({
    queryKey: ['sales-inventory-totals'],
    queryFn: async () => {
      const data = await fetchAllRows<any>('inventory', 'product_id, quantity');
      const t: Record<string, number> = {};
      (data || []).forEach((r: any) => { t[r.product_id] = (t[r.product_id] || 0) + r.quantity; });
      return t;
    },
    staleTime: 30000,
  });

  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const remaining = total - paidAmount;
  const status = total <= 0 ? 'مكتملة' : paidAmount <= 0 ? 'آجل' : paidAmount >= total ? 'مكتملة' : 'جزئي';

  const setItemField = useCallback((key: number, field: keyof QuickItem, value: any) => {
    setItems(prev => prev.map(it => {
      if (it._key !== key) return it;
      if (field === 'product_id') {
        const p = products.find((p: any) => p.id === value);
        return { ...it, product_id: value, product_name: p?.name || '', unit_price: p?.price || 0, unit: p?.unit || '' };
      }
      return { ...it, [field]: value };
    }));
  }, [products]);

  const addItem = () => setItems(prev => [...prev, { _key: ++_k, product_id: '', product_name: '', quantity: 1, unit_price: 0, unit: '' }]);
  const removeItem = (key: number) => setItems(prev => prev.filter(i => i._key !== key));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validItems = items.filter(i => i.product_id && i.quantity > 0 && i.unit_price > 0);
      if (validItems.length === 0) throw new Error('يرجى إضافة صنف واحد على الأقل');

      const cust = customers.find((c: any) => c.id === customerId);
      const { data: saleRow, error: se } = await supabase.from('sales').insert({
        customer_id: customerId || null,
        customer_name: cust?.name || 'عميل نقدي',
        total_amount: total,
        paid_amount: paidAmount,
        discount: 0,
        status,
        sale_date: today(),
      }).select('id,customer_id').single();
      if (se) throw se;

      await supabase.from('sale_items').insert(
        validItems.map(i => ({
          sale_id: saleRow.id,
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_price: i.quantity * i.unit_price,
          unit: i.unit,
        }))
      );

      // Deduct inventory
      for (const item of validItems) {
        const { data: invRows } = await supabase.from('inventory')
          .select('id, quantity').eq('product_id', item.product_id)
          .order('quantity', { ascending: false });
        let rem = item.quantity;
        for (const inv of (invRows || [])) {
          if (rem <= 0) break;
          const d = Math.min(rem, inv.quantity);
          await supabase.from('inventory').update({ quantity: inv.quantity - d, last_updated: new Date().toISOString() }).eq('id', inv.id);
          rem -= d;
        }
      }

      // Update customer balance if deferred
      if (remaining > 0 && saleRow.customer_id) {
        const { data: cu } = await supabase.from('customers').select('balance').eq('id', saleRow.customer_id).single();
        if (cu) await supabase.from('customers').update({ balance: (cu.balance || 0) + remaining }).eq('id', saleRow.customer_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sales-inventory-totals'] });
      qc.invalidateQueries({ queryKey: ['inventory-all'] });
      interact('success');
      toast.success('تم تسجيل البيع بنجاح');
      onClose();
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl animate-fade-up max-h-[95vh] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}>
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-sm">بيع سريع</p>
              <p className="text-xs text-slate-400">أضف الأصناف ثم احفظ</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Customer */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-600">العميل</label>
            <select value={customerId} onChange={e => { setCustomerId(e.target.value); if (e.target.value) { const c = customers.find((c: any) => c.id === e.target.value); if (c && (c.balance || 0) > 0) toast.info(`رصيد العميل: ${EGP(c.balance)}`); } }}
              className="bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-sm text-slate-800 focus:outline-none focus:border-gold-400 transition-all">
              <option value="">💵 عميل نقدي</option>
              {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}{(c.balance || 0) > 0 ? ` • دين: ${EGP(c.balance)}` : ''}</option>)}
            </select>
          </div>

          {/* Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">الأصناف</p>
              <button onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-gold-700 bg-gold-50 hover:bg-gold-100 border border-gold-200 px-3 py-1.5 rounded-xl transition-all">
                <Plus className="w-3 h-3" />إضافة صنف
              </button>
            </div>

            {items.map((item, idx) => {
              const avail = inventoryTotals[item.product_id] || 0;
              const filteredProds = products.filter((p: any) =>
                !productSearch[item._key] || p.name.includes(productSearch[item._key])
              );
              return (
                <div key={item._key} className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2.5">
                  {/* Product picker */}
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={item.product_id ? item.product_name : (productSearch[item._key] || '')}
                          placeholder="ابحث عن منتج..."
                          className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-8 pl-3 text-sm text-slate-800 focus:outline-none focus:border-gold-400"
                          onChange={e => { setProductSearch(s => ({ ...s, [item._key]: e.target.value })); if (item.product_id) setItemField(item._key, 'product_id', ''); setOpenDropdown(item._key); }}
                          onFocus={() => setOpenDropdown(item._key)}
                        />
                      </div>
                      {items.length > 1 && (
                        <button onClick={() => removeItem(item._key)} className="w-8 h-8 bg-red-50 hover:bg-red-100 text-red-400 rounded-xl flex items-center justify-center flex-shrink-0 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {openDropdown === item._key && filteredProds.length > 0 && (
                      <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-44 overflow-y-auto">
                        {filteredProds.slice(0, 15).map((p: any) => {
                          const inv = inventoryTotals[p.id] || 0;
                          return (
                            <button key={p.id}
                              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gold-50 text-right transition-colors border-b border-slate-50 last:border-0"
                              onClick={() => { setItemField(item._key, 'product_id', p.id); setProductSearch(s => ({ ...s, [item._key]: '' })); setOpenDropdown(null); }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                                <p className="text-xs text-slate-400">{p.unit}</p>
                              </div>
                              <div className="flex flex-col items-end gap-0.5 flex-shrink-0 mr-2">
                                <span className="text-xs font-bold text-gold-700">{EGP(p.price)}</span>
                                <span className={cn('text-xs font-medium', inv === 0 ? 'text-red-500' : inv < 10 ? 'text-amber-500' : 'text-emerald-500')}>
                                  {inv === 0 ? 'نافد' : `متاح: ${inv}`}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Qty + Price */}
                  {item.product_id && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">الكمية {avail > 0 && <span className="text-emerald-600">(متاح: {avail})</span>}</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setItemField(item._key, 'quantity', Math.max(1, item.quantity - 1))}
                            className="w-8 h-8 bg-white border border-slate-200 rounded-lg text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100 flex-shrink-0">−</button>
                          <input type="number" value={item.quantity || ''} min={1}
                            onChange={e => setItemField(item._key, 'quantity', Number(e.target.value))}
                            className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-sm text-center font-bold focus:outline-none focus:border-gold-400" />
                          <button onClick={() => setItemField(item._key, 'quantity', item.quantity + 1)}
                            className="w-8 h-8 bg-white border border-slate-200 rounded-lg text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100 flex-shrink-0">+</button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-slate-500">سعر البيع (ج.م)</label>
                        <input type="number" value={item.unit_price || ''}
                          onChange={e => setItemField(item._key, 'unit_price', Number(e.target.value))}
                          className="bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:outline-none focus:border-gold-400" />
                      </div>
                    </div>
                  )}

                  {/* Subtotal */}
                  {item.product_id && item.unit_price > 0 && (
                    <div className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-slate-100">
                      <span className="text-xs text-slate-400">{item.product_name} × {item.quantity}</span>
                      <span className="text-sm font-bold text-emerald-600">{EGP(item.quantity * item.unit_price)}</span>
                    </div>
                  )}

                  {item.product_id && item.quantity > avail && avail > 0 && (
                    <p className="text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">⚠ المتاح فقط {avail} وحدة</p>
                  )}
                  {item.product_id && avail === 0 && (
                    <p className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">⚠ المخزون نافد</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Payment summary */}
          {total > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">الإجمالي</span>
                <span className="text-xl font-black text-emerald-600">{EGP(total)}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-600">المبلغ المدفوع (ج.م)</label>
                <div className="flex gap-2">
                  <input type="number" value={paidAmount || ''} onChange={e => setPaidAmount(Number(e.target.value))}
                    placeholder="0"
                    className="flex-1 bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-sm font-bold focus:outline-none focus:border-gold-400" />
                  <button onClick={() => setPaidAmount(total)}
                    className="px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold hover:bg-emerald-100 transition-all whitespace-nowrap">
                    الكل
                  </button>
                </div>
              </div>
              {remaining > 0 && (
                <div className={cn('flex items-center justify-between text-sm font-semibold rounded-xl px-3 py-2',
                  'bg-amber-50 border border-amber-200 text-amber-700')}>
                  <span>آجل / متبقي</span>
                  <span>{EGP(remaining)}</span>
                </div>
              )}
              <div className={cn('text-xs px-3 py-2 rounded-xl border font-bold text-center',
                status === 'مكتملة' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : status === 'آجل' ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-amber-50 border-amber-200 text-amber-700')}>
                الحالة: {status}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex gap-3">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || total === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-white font-bold rounded-2xl transition-all disabled:opacity-50 text-sm active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}>
            <Zap className="w-4 h-4" />
            {saveMutation.isPending ? 'جاري الحفظ...' : 'تسجيل البيع'}
          </button>
          <button onClick={onClose} className="px-5 py-3 bg-slate-100 text-slate-600 rounded-2xl font-semibold text-sm hover:bg-slate-200 transition-all">
            إلغاء
          </button>
        </div>
      </div>

      {/* Close dropdown on outside click */}
      {openDropdown !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
      )}
    </div>
  );
};

export default QuickSaleModal;
