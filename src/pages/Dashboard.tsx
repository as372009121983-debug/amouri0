import { type ElementType, useMemo } from 'react';
import {
  TrendingUp, ShoppingCart, DollarSign,
  Users, Package, Plus, FileText, BarChart3,
  AlertTriangle, UserPlus, Truck, RefreshCw, ArrowUpRight,
  Wallet,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar,
  PieChart, Pie, Cell,
} from 'recharts';

const EGP = (v: number) =>
  v === 0 ? '٠ ج.م' : v.toLocaleString('ar-EG', { minimumFractionDigits: 0 }) + ' ج.م';

const todayStr = () => new Date().toISOString().split('T')[0];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-sm min-w-32">
      <p className="text-slate-400 text-xs mb-2 font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="font-bold text-xs">{p.name}: {EGP(p.value)}</p>
      ))}
    </div>
  );
};

/* KPI Card config */
interface DashCard {
  label: string; value: string; sub: string;
  icon: ElementType; bg: string; iconBg: string; iconColor: string; valueColor: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const today = todayStr();

  const { data: daySales = [] } = useQuery({
    queryKey: ['dash-sales', today],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales').select('total_amount,paid_amount,initial_paid_amount,status,sale_date,sale_items(product_id,quantity,unit_price,total_price)').eq('sale_date', today);
      return data || [];
    },
    staleTime: 0, refetchOnWindowFocus: true,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['dash-products-cost'],
    queryFn: async () => fetchAllRows<{ id: string; purchase_price: number }>('products', 'id,purchase_price'),
    staleTime: 120000,
  });

  const { data: dayPurchases = [] } = useQuery({
    queryKey: ['dash-pur', today],
    queryFn: async () => { const { data } = await supabase.from('purchases').select('total_amount').eq('purchase_date', today); return data || []; },
    staleTime: 30000,
  });

  const { data: dayExpenses = [] } = useQuery({
    queryKey: ['dash-exp', today],
    queryFn: async () => { const { data } = await supabase.from('expenses').select('amount').eq('expense_date', today); return data || []; },
    staleTime: 30000,
  });

  const { data: customerDebt = 0 } = useQuery({
    queryKey: ['dash-cdebt'],
    queryFn: async () => { const { data } = await supabase.from('customers').select('balance'); return (data || []).reduce((s: number, c: any) => s + (c.balance > 0 ? c.balance : 0), 0); },
    staleTime: 0, refetchOnWindowFocus: true,
  });

  const { data: supplierDebt = 0 } = useQuery({
    queryKey: ['dash-sdebt'],
    queryFn: async () => { const { data } = await supabase.from('suppliers').select('balance'); return (data || []).reduce((s: number, c: any) => s + (c.balance > 0 ? c.balance : 0), 0); },
    staleTime: 60000,
  });

  const { data: invValue = 0 } = useQuery({
    queryKey: ['dash-inv'],
    queryFn: async () => { const data = await fetchAllRows<any>('inventory', 'quantity, products(purchase_price)'); return (data || []).reduce((s: number, r: any) => s + (r.quantity * (r.products?.purchase_price || 0)), 0); },
    staleTime: 0, refetchOnWindowFocus: true,
  });

  const { data: alertsCount = 0 } = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: async () => { const { count } = await supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('read', false); return count ?? 0; },
    staleTime: 30000,
  });

  const { data: weeklyData = [] } = useQuery({
    queryKey: ['dash-weekly'],
    queryFn: async () => {
      const days: { date: string; label: string }[] = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ date: d.toISOString().split('T')[0], label: d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' }) }); }
      const [{ data: salesData }, { data: purchasesData }, { data: expensesData }] = await Promise.all([
        supabase.from('sales').select('sale_date, total_amount, paid_amount').gte('sale_date', days[0].date),
        supabase.from('purchases').select('purchase_date, total_amount').gte('purchase_date', days[0].date),
        supabase.from('expenses').select('expense_date, amount').gte('expense_date', days[0].date),
      ]);
      return days.map(d => ({
        label: d.label,
        مبيعات: (salesData || []).filter((s: any) => s.sale_date === d.date).reduce((s: number, x: any) => s + x.total_amount, 0),
        مشتريات: (purchasesData || []).filter((p: any) => p.purchase_date === d.date).reduce((s: number, x: any) => s + x.total_amount, 0),
        مصروفات: (expensesData || []).filter((e: any) => e.expense_date === d.date).reduce((s: number, x: any) => s + x.amount, 0),
      }));
    },
    staleTime: 60000,
  });

  const { data: expensesByCategory = [] } = useQuery({
    queryKey: ['dash-expenses-cat'],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('category, amount');
      const cats: Record<string, number> = {};
      (data || []).forEach((e: any) => { cats[e.category || 'عام'] = (cats[e.category || 'عام'] || 0) + e.amount; });
      return Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 8);
    },
    staleTime: 60000,
  });

  const { data: topProducts = [] } = useQuery({
    queryKey: ['dash-top-products'],
    queryFn: async () => {
      const monthStart = new Date(); monthStart.setDate(1);
      const monthStr = monthStart.toISOString().split('T')[0];
      const { data } = await supabase.from('sale_items').select('product_name, quantity, total_price, sale_id, sales!inner(sale_date)').gte('sales.sale_date', monthStr);
      const prods: Record<string, { qty: number; revenue: number }> = {};
      (data || []).forEach((it: any) => { if (!prods[it.product_name]) prods[it.product_name] = { qty: 0, revenue: 0 }; prods[it.product_name].qty += it.quantity; prods[it.product_name].revenue += it.total_price || 0; });
      return Object.entries(prods).map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue })).sort((a, b) => b.qty - a.qty).slice(0, 8);
    },
    staleTime: 60000,
  });

  const { data: monthlyData = [] } = useQuery({
    queryKey: ['dash-monthly'],
    queryFn: async () => {
      const months: { month: string; label: string }[] = [];
      for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); months.push({ month: d.toISOString().slice(0, 7), label: d.toLocaleString('ar-EG', { month: 'short' }) }); }
      const [{ data: salesData }, { data: purchasesData }] = await Promise.all([
        supabase.from('sales').select('sale_date, total_amount'),
        supabase.from('purchases').select('purchase_date, total_amount'),
      ]);
      return months.map(m => ({
        label: m.label,
        مبيعات: (salesData || []).filter((s: any) => s.sale_date.startsWith(m.month)).reduce((s: number, x: any) => s + x.total_amount, 0),
        مشتريات: (purchasesData || []).filter((p: any) => p.purchase_date.startsWith(m.month)).reduce((s: number, x: any) => s + x.total_amount, 0),
      }));
    },
    staleTime: 120000,
  });

  const productCostMap = useMemo(() => {
    const m: Record<string, number> = {};
    (allProducts as any[]).forEach(p => { m[p.id] = p.purchase_price || 0; });
    return m;
  }, [allProducts]);

  const totalDayInvoices   = (daySales as any[]).reduce((s: number, x: any) => s + Number(x.total_amount), 0);
  const totalDayInvoicesCt = (daySales as any[]).length;
  const totalSales         = (daySales as any[]).filter((x: any) => ['نقدي','كاملة','مكتملة','جزئي'].includes(x.status)).reduce((s: number, x: any) => s + Number(x.total_amount), 0);
  const totalPurchases     = (dayPurchases as any[]).reduce((s, x) => s + Number(x.total_amount), 0);
  const totalExpenses      = (dayExpenses as any[]).reduce((s, x) => s + Number(x.amount), 0);

  const trueDailyProfit = useMemo(() => {
    return (daySales as any[]).reduce((total: number, sale: any) => {
      const items = (sale.sale_items || []) as any[];
      return total + items.reduce((s: number, it: any) => {
        const cost = productCostMap[it.product_id] || 0;
        if (!cost) return s;
        return s + ((it.unit_price - cost) * it.quantity);
      }, 0);
    }, 0);
  }, [daySales, productCostMap]);

  const hasTrueProfitData = (daySales as any[]).some((sale: any) => (sale.sale_items || []).some((it: any) => productCostMap[it.product_id] > 0));
  const netProfit = totalSales - totalPurchases - totalExpenses;
  const displayProfit = hasTrueProfitData ? trueDailyProfit : netProfit;

  const cards: DashCard[] = [
    { label: 'فواتير اليوم', value: EGP(totalDayInvoices), sub: `${totalDayInvoicesCt} فاتورة إجمالاً`, icon: FileText, bg: '#eff6ff', iconBg: '#dbeafe', iconColor: '#1d4ed8', valueColor: '#1e40af' },
    { label: 'صافي الربح', value: EGP(displayProfit), sub: hasTrueProfitData ? 'بيع − تكلفة الأصناف' : 'إجمالي − مشتريات − مصروفات', icon: DollarSign, bg: displayProfit >= 0 ? '#f0fdf4' : '#fef2f2', iconBg: displayProfit >= 0 ? '#dcfce7' : '#fee2e2', iconColor: displayProfit >= 0 ? '#15803d' : '#b91c1c', valueColor: displayProfit >= 0 ? '#15803d' : '#b91c1c' },
    { label: 'مبيعات اليوم', value: EGP(totalSales), sub: `${(daySales as any[]).filter((x: any) => ['نقدي','كاملة','مكتملة','جزئي'].includes(x.status)).length} فاتورة مكتملة`, icon: TrendingUp, bg: '#f0fdf4', iconBg: '#dcfce7', iconColor: '#15803d', valueColor: '#15803d' },
    { label: 'مشتريات اليوم', value: EGP(totalPurchases), sub: `${(dayPurchases as any[]).length} أمر شراء`, icon: ShoppingCart, bg: '#fdf4ff', iconBg: '#f3e8ff', iconColor: '#7c3aed', valueColor: '#6d28d9' },
    { label: 'ديون العملاء', value: EGP(customerDebt as number), sub: 'إجمالي المستحق', icon: Users, bg: '#fffbeb', iconBg: '#fef3c7', iconColor: '#b45309', valueColor: '#92400e' },
    { label: 'ديون الموردين', value: EGP(supplierDebt as number), sub: 'إجمالي المستحق لهم', icon: Truck, bg: '#fef2f2', iconBg: '#fee2e2', iconColor: '#b91c1c', valueColor: '#991b1b' },
  ];

  const shortcuts = [
    { icon: Plus,          label: 'فاتورة بيع',   sub: 'بيع جديد',      path: '/sales',     color: '#a97a1f',  bg: '#faf0d4' },
    { icon: ShoppingCart,  label: 'أمر شراء',     sub: 'شراء مورد',     path: '/purchases', color: '#7c3aed',  bg: '#f3e8ff' },
    { icon: Package,       label: 'منتج جديد',    sub: 'إضافة صنف',     path: '/products',  color: '#0369a1',  bg: '#dbeafe' },
    { icon: UserPlus,      label: 'عميل جديد',    sub: 'إضافة عميل',    path: '/customers', color: '#b45309',  bg: '#fef3c7' },
    { icon: Wallet,        label: 'مصروف',        sub: 'تسجيل مصروف',   path: '/expenses',  color: '#b91c1c',  bg: '#fee2e2' },
    { icon: BarChart3,     label: 'التقارير',      sub: 'أرباح وتحليل',  path: '/reports',   color: '#4f46e5',  bg: '#ede9fe' },
    { icon: AlertTriangle, label: 'التنبيهات',    sub: `${alertsCount} غير مقروء`, path: '/alerts', color: '#c2410c', bg: '#ffedd5' },
    { icon: RefreshCw,     label: 'المرتجعات',     sub: 'إرجاع بضاعة',   path: '/returns',   color: '#374151',  bg: '#f3f4f6' },
  ];

  const PIE_COLORS = ['#a97a1f','#059669','#7c3aed','#d97706','#dc2626','#0284c7','#db2777','#64748b'];
  const maxTopQty = topProducts.length > 0 ? topProducts[0].qty : 1;

  const dateStr = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-5 pb-6">

      {/* ── Page header ── */}
      <div className="animate-fade-up flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 font-medium">{dateStr}</p>
          <h2 className="text-3xl font-black text-slate-800 mt-1 tracking-tight">
            {profile?.full_name ? `مرحباً، ${profile.full_name}` : 'لوحة التحكم'}
          </h2>
          <p className="text-sm text-slate-400 mt-1">نظرة عامة على أداء اليوم</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 mt-1">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#faf0d4', color: '#a97a1f', border: '1px solid #e9c66d' }}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            النظام يعمل
          </span>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card, i) => {
          const Icon: ElementType = card.icon;
          return (
            <div key={i}
              className="stat-card animate-fade-up cursor-default select-none"
              style={{ background: card.bg, borderColor: 'transparent', animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: card.iconBg }}>
                  <Icon className="w-6 h-6" style={{ color: card.iconColor }} />
                </div>
                <span className="text-sm font-semibold text-slate-400 mt-1">{card.label}</span>
              </div>
              <p className="text-2xl font-black leading-tight break-all" style={{ color: card.valueColor }}>{card.value}</p>
              <p className="text-sm text-slate-400 mt-2 leading-tight">{card.sub}</p>
            </div>
          );
        })}
      </div>

      {/* ── Inventory Value Banner ── */}
      <div className="section-card animate-fade-up" style={{ animationDelay: '300ms' }}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0369a1,#38bdf8)', boxShadow: '0 4px 16px rgba(3,105,161,0.32)' }}>
              <Package className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">قيمة المخزون الكلية (بسعر الشراء)</p>
              <p className="text-3xl font-black text-blue-700 mt-1">{EGP(invValue as number)}</p>
            </div>
          </div>
          <button onClick={() => navigate('/inventory')}
            className="flex items-center gap-1.5 text-xs text-blue-600 font-bold hover:text-blue-800 transition-colors px-3 py-2 rounded-xl hover:bg-blue-50">
            عرض الجرد <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Weekly Area Chart */}
        <div className="section-card animate-fade-up" style={{ animationDelay: '350ms' }}>
          <div className="section-header">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gold-50 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-gold-600" />
              </div>
              <span className="font-bold text-base text-slate-800">حركة آخر 7 أيام</span>
            </div>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={weeklyData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPur" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="مبيعات" stroke="#10b981" strokeWidth={2} fill="url(#gSales)" dot={false} />
                <Area type="monotone" dataKey="مشتريات" stroke="#7c3aed" strokeWidth={2} fill="url(#gPur)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex gap-4 justify-center mt-2">
              {[{ color: '#10b981', label: 'مبيعات' }, { color: '#7c3aed', label: 'مشتريات' }].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="w-3 h-1.5 rounded-full" style={{ background: l.color }} />
                  <span className="text-xs text-slate-400">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Monthly Bar Chart */}
        <div className="section-card animate-fade-up" style={{ animationDelay: '380ms' }}>
          <div className="section-header">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <span className="font-bold text-base text-slate-800">مقارنة 6 أشهر</span>
            </div>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="مبيعات" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="مشتريات" fill="#7c3aed" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Expenses Pie + Top Products ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up" style={{ animationDelay: '420ms' }}>
        {/* Pie */}
        <div className="section-card">
          <div className="section-header">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center">
                <span className="w-3 h-3 rounded-full bg-rose-500" />
              </div>
              <span className="font-bold text-base text-slate-800">توزيع المصروفات</span>
            </div>
          </div>
          <div className="p-4">
            {expensesByCategory.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-slate-300 text-sm">لا توجد بيانات</div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie data={expensesByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={68} paddingAngle={3}>
                      {expensesByCategory.map((_: any, idx: number) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => EGP(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 min-w-0 space-y-1.5">
                  {expensesByCategory.map((cat: any, idx: number) => (
                    <div key={cat.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                      <span className="text-xs text-slate-600 flex-1 truncate">{cat.name}</span>
                      <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{EGP(cat.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Products */}
        <div className="section-card">
          <div className="section-header">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <span className="font-bold text-base text-slate-800">أكثر المنتجات مبيعاً</span>
            </div>
            <span className="text-xs text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-lg">
              {new Date().toLocaleString('ar-EG',{month:'long'})}
            </span>
          </div>
          <div className="p-4">
            {topProducts.length === 0 ? (
              <div className="flex items-center justify-center h-28 text-slate-300 text-sm">لا توجد مبيعات</div>
            ) : (
              <div className="space-y-3">
                {topProducts.map((prod: any, idx: number) => {
                  const pct = maxTopQty > 0 ? (prod.qty / maxTopQty) * 100 : 0;
                  return (
                    <div key={prod.name}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-lg flex items-center justify-center text-white text-xs font-black flex-shrink-0"
                            style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }}>{idx + 1}</span>
                          <span className="text-xs font-semibold text-slate-700 truncate">{prod.name}</span>
                        </div>
                        <span className="text-xs font-black whitespace-nowrap mr-2" style={{ color: PIE_COLORS[idx % PIE_COLORS.length] }}>
                          {prod.qty.toLocaleString('ar-EG')} وحدة
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Shortcuts ── */}
      <div className="animate-fade-up" style={{ animationDelay: '460ms' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">⚡</span>
            <p className="text-base font-bold text-slate-700">وصول سريع</p>
          </div>
          <p className="text-xs text-slate-400">اضغط للانتقال</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {shortcuts.map((sc, i) => {
            const Icon = sc.icon;
            return (
              <button key={i} onClick={() => navigate(sc.path)}
                className="section-card flex flex-col items-start gap-3 p-4 text-right w-full transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
                style={{ animationDelay: `${480 + i * 30}ms` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: sc.bg }}>
                  <Icon className="w-6 h-6" style={{ color: sc.color }} />
                </div>
                <div>
                  <p className="text-base font-bold text-slate-800 leading-tight">{sc.label}</p>
                  <p className="text-sm text-slate-400 mt-0.5">{sc.sub}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
