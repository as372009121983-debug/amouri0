import { useState, type ReactNode } from 'react';
import { Bell, AlertTriangle, Info, CheckCircle, XCircle, Trash2, CheckCheck, Plus, X } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Alert } from '@/types';

const ALERT_TYPES = ['خطأ', 'تحذير', 'معلومة', 'نجاح'];

const Alerts = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('الكل');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ type: 'معلومة', message: '', warehouse_name: '' });

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('alerts').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Alert[];
    },
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alerts').update({ read: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); qc.invalidateQueries({ queryKey: ['alerts-unread'] }); },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('alerts').update({ read: true }).eq('read', false);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); qc.invalidateQueries({ queryKey: ['alerts-unread'] }); interact('success'); toast.success('تم تعليم جميع التنبيهات كمقروءة'); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alerts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); interact('delete'); toast.info('تم حذف التنبيه'); },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('alerts').insert({
        type: addForm.type, message: addForm.message,
        warehouse_name: addForm.warehouse_name || null, read: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-unread'] });
      interact('success'); toast.success('تم إضافة التنبيه');
      setShowAddForm(false); setAddForm({ type: 'معلومة', message: '', warehouse_name: '' });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const typeConfig: Record<string, { icon: ReactNode; color: string; bg: string; border: string; dot: string }> = {
    'خطأ':    { icon: <XCircle className="w-4 h-4" />,       color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200',     dot: 'bg-red-500' },
    'تحذير':  { icon: <AlertTriangle className="w-4 h-4" />, color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200',   dot: 'bg-amber-500' },
    'معلومة': { icon: <Info className="w-4 h-4" />,          color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200',    dot: 'bg-blue-500' },
    'نجاح':   { icon: <CheckCircle className="w-4 h-4" />,   color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  };

  const filtered = alerts.filter(a => {
    if (filter === 'الكل') return true;
    if (filter === 'غير مقروء') return !a.read;
    return a.type === filter;
  });

  const unreadCount = alerts.filter(a => !a.read).length;
  const isAdmin = profile?.role === 'admin' || profile?.role === 'warehouse_manager';

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 bg-red-500 rounded-xl animate-pulse" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)' }}>
        <div className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Bell className="w-4 h-4 text-red-200" />
                <span className="text-xs text-red-200 font-medium">مركز التنبيهات</span>
              </div>
              <p className="text-2xl font-black text-white">{alerts.length} تنبيه</p>
              <p className="text-xs text-red-200 mt-1">{unreadCount} غير مقروء</p>
            </div>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button className="flex items-center gap-1.5 px-3 py-2 bg-white/15 hover:bg-white/25 text-white rounded-xl text-xs font-semibold transition-all border border-white/20"
                  onClick={() => { interact('click'); markAllReadMutation.mutate(); }}>
                  <CheckCheck className="w-3.5 h-3.5" /><span className="hidden sm:inline">تعليم الكل</span>
                </button>
              )}
              {isAdmin && (
                <button className="flex items-center gap-1.5 px-3 py-2 bg-white text-red-700 rounded-xl text-xs font-bold hover:bg-red-50 transition-all"
                  onClick={() => { interact('add'); setShowAddForm(true); }}>
                  <Plus className="w-3.5 h-3.5" /><span>إضافة</span>
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {ALERT_TYPES.map(t => {
              const count = alerts.filter(a => a.type === t).length;
              return (
                <div key={t} className="bg-white/10 rounded-xl p-2 text-center">
                  <p className="text-xs text-red-200">{t}</p>
                  <p className="text-sm font-black text-white">{count}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['الكل', 'غير مقروء', ...ALERT_TYPES].map(f => (
          <button key={f}
            className={cn('px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
              filter === f ? 'bg-red-500 text-white border-red-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-red-200')}
            onClick={() => { interact('click'); setFilter(f); }}>
            {f}
            {f === 'غير مقروء' && unreadCount > 0 && (
              <span className="mr-1.5 bg-white text-red-500 text-xs px-1.5 rounded-full font-black">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Alerts List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 border border-slate-100 text-center">
            <Bell className="w-12 h-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">لا توجد تنبيهات</p>
          </div>
        ) : (
          filtered.map((alert, i) => {
            const tc = typeConfig[alert.type] || typeConfig['معلومة'];
            return (
              <div key={alert.id}
                className={cn(
                  'bg-white rounded-2xl p-4 border transition-all animate-fade-up cursor-pointer hover:shadow-sm',
                  !alert.read ? `${tc.border} ring-1 ring-inset ring-current/10` : 'border-slate-100',
                  !alert.read && tc.bg + '/30'
                )}
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                onClick={() => { if (!alert.read) { interact('click'); markReadMutation.mutate(alert.id); } }}>
                <div className="flex items-start gap-3">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', tc.bg, tc.color, 'border', tc.border)}>
                    {tc.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-lg border', tc.color, tc.bg, tc.border)}>{alert.type}</span>
                          {!alert.read && (
                            <span className={cn('w-2 h-2 rounded-full animate-pulse', tc.dot)} />
                          )}
                          {alert.warehouse_name && (
                            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{alert.warehouse_name}</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-800 font-medium leading-relaxed">{alert.message}</p>
                        <p className="text-xs text-slate-400 mt-1.5">
                          {new Date(alert.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!alert.read && (
                          <button
                            className={cn('w-7 h-7 rounded-lg flex items-center justify-center border transition-all', tc.bg, tc.border, tc.color, 'hover:opacity-80')}
                            onClick={e => { e.stopPropagation(); interact('click'); markReadMutation.mutate(alert.id); }}>
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          className="w-7 h-7 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg flex items-center justify-center border border-slate-200 transition-all"
                          onClick={e => { e.stopPropagation(); deleteMutation.mutate(alert.id); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center"><Bell className="w-4 h-4 text-white" /></div>
                <h2 className="text-base font-bold text-slate-800">إضافة تنبيه</h2>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center" onClick={() => setShowAddForm(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">نوع التنبيه</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {ALERT_TYPES.map(t => {
                    const tc = typeConfig[t];
                    return (
                      <button key={t} type="button"
                        onClick={() => setAddForm(p => ({ ...p, type: t }))}
                        className={cn('py-2 px-2 rounded-xl text-xs font-semibold border transition-all text-center',
                          addForm.type === t ? cn(tc.bg, tc.border, tc.color) : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300')}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">نص التنبيه *</label>
                <textarea value={addForm.message} onChange={e => setAddForm(p => ({ ...p, message: e.target.value }))}
                  placeholder="اكتب نص التنبيه..." rows={3}
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-red-300 text-slate-800 resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">اسم المخزن (اختياري)</label>
                <input type="text" value={addForm.warehouse_name} onChange={e => setAddForm(p => ({ ...p, warehouse_name: e.target.value }))}
                  placeholder="مثال: المخزن الرئيسي"
                  className="w-full border border-slate-200 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:border-red-300 text-slate-800" />
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl py-2.5 font-semibold transition-all"
                onClick={() => { if (!addForm.message) { toast.error('يرجى إدخال نص التنبيه'); return; } addMutation.mutate(); }}
                disabled={addMutation.isPending}>{addMutation.isPending ? 'جاري...' : 'إضافة التنبيه'}</button>
              <button className="flex-1 bg-slate-100 text-slate-500 rounded-xl py-2.5"
                onClick={() => setShowAddForm(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Alerts;
