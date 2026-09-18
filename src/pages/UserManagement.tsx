import { useState } from 'react';
import { Shield, Search, UserCheck, UserX, Trash2, Edit2, X, Phone, Mail, Crown, KeyRound } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';

const INPUT = 'w-full bg-white border border-slate-200 rounded-xl py-2.5 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-gold-400 transition-all';

interface UserProfile {
  id: string;
  username: string | null;
  email: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  active: boolean | null;
  max_salary: number | null;
  owner_id: string | null;
}

const ROLES: Record<string, { label: string; color: string }> = {
  admin:             { label: 'مدير النظام',  color: 'text-red-700 bg-red-50 border-red-200' },
  warehouse_manager: { label: 'مدير مخزن',    color: 'text-blue-700 bg-blue-50 border-blue-200' },
  driver:            { label: 'سائق',          color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  worker:            { label: 'عامل',           color: 'text-orange-700 bg-orange-50 border-orange-200' },
  boss:              { label: 'الرئيس',          color: 'text-purple-700 bg-purple-50 border-purple-200' },
};

const UserManagement = () => {
  const { interact } = useInteraction();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', role: 'worker', active: true });
  const [resetUser, setResetUser] = useState<UserProfile | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPhone, setResetPhone] = useState('');
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetLoading, setResetLoading] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, username, email, role, full_name, phone, active, max_salary, owner_id')
        .order('full_name');
      if (error) throw error;
      return data as UserProfile[];
    },
    staleTime: 15000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<UserProfile> }) => {
      const { error } = await supabase.from('user_profiles').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-users'] });
      interact('success');
      toast.success('تم تحديث بيانات المستخدم');
      setEditUser(null);
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_profiles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-users'] });
      interact('delete');
      toast.success('تم حذف المستخدم');
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const toggleActive = (user: UserProfile) => {
    updateMutation.mutate({ id: user.id, payload: { active: !(user.active !== false) } });
  };

  const openReset = (phone: string, user: UserProfile | null = null) => {
    interact('click');
    setResetUser(user);
    setResetPhone(phone);
    setResetForm({ password: '', confirm: '' });
    setResetModalOpen(true);
  };

  const closeReset = () => {
    setResetModalOpen(false);
    setResetUser(null);
    setResetPhone('');
  };

  const submitReset = async () => {
    if (!resetPhone || resetPhone.replace(/\D/g, '').length < 8) {
      toast.error('يرجى إدخال رقم هاتف صحيح');
      return;
    }
    if (!resetForm.password || resetForm.password.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (resetForm.password !== resetForm.confirm) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }
    setResetLoading(true);
    const { data, error } = await supabase.functions.invoke('create-worker', {
      body: { action: 'super_reset_password', phone: resetPhone, newPassword: resetForm.password },
    });
    setResetLoading(false);
    if (error || data?.error) {
      interact('error');
      // supabase-js doesn't parse the response body when the function returns
      // a non-2xx status — the real error message lives on error.context
      // (the raw Response). Without reading it we'd only ever see the
      // generic "Edge Function returned a non-2xx status code".
      let msg = data?.error || error?.message || 'حدث خطأ أثناء تغيير كلمة المرور';
      if (error instanceof FunctionsHttpError) {
        try {
          const txt = await error.context?.text();
          if (txt) {
            try { msg = JSON.parse(txt)?.error || txt; } catch { msg = txt; }
          }
        } catch { /* noop */ }
      }
      toast.error(msg);
      return;
    }
    interact('success');
    toast.success(data?.message || 'تم تغيير كلمة المرور بنجاح');
    closeReset();
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return (u.full_name || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.phone || '').includes(q)
      || (u.username || '').toLowerCase().includes(q);
  });

  const stats = {
    total:    users.length,
    active:   users.filter(u => u.active !== false).length,
    inactive: users.filter(u => u.active === false).length,
    admins:   users.filter(u => u.role === 'admin').length,
  };

  if (isLoading) return <div className="page-loader"><div className="page-loader-inner" /></div>;

  return (
    <div className="space-y-5">

      {/* Hero Header */}
      <div className="rounded-2xl overflow-hidden shadow-md" style={{ background: 'linear-gradient(135deg,#1e293b,#334155)' }}>
        <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center border border-white/20">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-black text-white text-xl">إدارة المستخدمين</h1>
              <p className="text-slate-400 text-xs mt-0.5">التحكم الكامل في كل حسابات النظام — خاص بصاحب الحساب الرئيسي</p>
            </div>
          </div>
          <button type="button"
            onClick={() => openReset('')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 transition-colors">
            <KeyRound className="w-4 h-4" />
            استعادة كلمة مرور برقم الهاتف
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي المستخدمين', val: stats.total,    border: 'border-blue-200',    bg: 'bg-blue-50/60',    text: 'text-blue-700' },
          { label: 'نشطون',              val: stats.active,   border: 'border-emerald-200', bg: 'bg-emerald-50/60', text: 'text-emerald-700' },
          { label: 'معطّلون',            val: stats.inactive, border: 'border-red-200',     bg: 'bg-red-50/60',     text: 'text-red-700' },
          { label: 'مديرو النظام',       val: stats.admins,   border: 'border-amber-200',   bg: 'bg-amber-50/60',   text: 'text-amber-700' },
        ].map((s, i) => (
          <div key={i} className={`rounded-xl p-4 border ${s.border} ${s.bg}`}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-black ${s.text}`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" placeholder="البحث بالاسم، الهاتف، البريد..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-10 pl-3 text-sm focus:outline-none focus:border-gold-400" />
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="daily-table min-w-[600px]">
            <thead>
              <tr style={{ background: 'linear-gradient(135deg,#1e293b,#334155)' }}>
                <th className="tbl-head">#</th>
                <th className="tbl-head">المستخدم</th>
                <th className="tbl-head">الدور</th>
                <th className="tbl-head hidden md:table-cell">الهاتف</th>
                <th className="tbl-head hidden lg:table-cell">البريد</th>
                <th className="tbl-head text-center">الحالة</th>
                <th className="tbl-head text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => {
                const isActive = user.active !== false;
                const isSelf   = profile?.id === user.id;
                const roleInfo = ROLES[user.role] || { label: user.role, color: 'text-slate-600 bg-slate-100 border-slate-200' };
                return (
                  <tr key={user.id} className={cn('tbl-row', !isActive && 'opacity-60')}>
                    <td className="px-3 py-3 text-xs text-slate-400 text-center">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white text-sm"
                          style={{ background: isActive ? 'linear-gradient(135deg,#a97a1f,#dfb246)' : '#94a3b8' }}>
                          {(user.full_name || user.username || user.email || 'م').charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm text-slate-800">{user.full_name || user.username || '—'}</p>
                          <p className="text-xs text-slate-400">{user.owner_id ? 'تابع' : 'مستقل'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold', roleInfo.color)}>
                        {roleInfo.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 hidden md:table-cell">
                      {user.phone ? (
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{user.phone}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 hidden lg:table-cell">
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{user.email}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn('text-xs px-2 py-0.5 rounded-lg border font-semibold',
                        isActive ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')}>
                        {isActive ? 'نشط' : 'معطّل'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {/* تعديل */}
                        <button type="button"
                          onClick={() => {
                            setEditUser(user);
                            setEditForm({ full_name: user.full_name || '', phone: user.phone || '', role: user.role, active: isActive });
                          }}
                          title="تعديل"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {/* استعادة كلمة المرور */}
                        <button type="button"
                          onClick={() => openReset(user.phone || '', user)}
                          title="استعادة كلمة المرور"
                          disabled={!user.phone}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        {/* تفعيل/تعطيل */}
                        {!isSelf && (
                          <button type="button"
                            onClick={() => toggleActive(user)}
                            title={isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                            className={cn('inline-flex items-center justify-center w-8 h-8 rounded-xl transition-colors',
                              isActive ? 'bg-red-50 hover:bg-red-100 text-red-500' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600')}>
                            {isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {/* حذف */}
                        {!isSelf && (
                          <button type="button"
                            onClick={() => {
                              if (confirm(`حذف المستخدم "${user.full_name || user.email}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) {
                                deleteMutation.mutate(user.id);
                              }
                            }}
                            title="حذف"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                    <Shield className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    لا توجد نتائج
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center">
                  <Edit2 className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">تعديل المستخدم</h2>
                  <p className="text-xs text-slate-400">{editUser.email}</p>
                </div>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center"
                onClick={() => setEditUser(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">الاسم الكامل</label>
                <input type="text" value={editForm.full_name}
                  onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))}
                  className={INPUT} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">رقم الهاتف</label>
                <input type="text" value={editForm.phone}
                  onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                  className={INPUT} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">الدور الوظيفي</label>
                <select value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))} className={INPUT}>
                  <option value="admin">مدير النظام</option>
                  <option value="warehouse_manager">مدير مخزن</option>
                  <option value="driver">سائق</option>
                  <option value="worker">عامل</option>
                  <option value="boss">الرئيس (مشاهدة فقط)</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="active-toggle" checked={editForm.active}
                  onChange={e => setEditForm(p => ({ ...p, active: e.target.checked }))}
                  className="w-4 h-4 rounded" />
                <label htmlFor="active-toggle" className="text-sm font-medium text-slate-700">الحساب نشط</label>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-semibold text-sm transition-all"
                style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}
                onClick={() => updateMutation.mutate({ id: editUser.id, payload: { full_name: editForm.full_name, phone: editForm.phone, role: editForm.role, active: editForm.active } })}
                disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'جاري...' : 'حفظ التعديلات'}
              </button>
              <button className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm transition-all"
                onClick={() => setEditUser(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                  <KeyRound className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800">استعادة كلمة المرور</h2>
                  <p className="text-xs text-slate-400">
                    {resetUser ? (resetUser.full_name || resetUser.email) : 'ابحث بأي رقم هاتف في النظام'}
                  </p>
                </div>
              </div>
              <button className="w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl flex items-center justify-center"
                onClick={closeReset}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">رقم الهاتف</label>
                <input type="text" value={resetPhone}
                  onChange={e => setResetPhone(e.target.value)}
                  disabled={!!resetUser}
                  placeholder="01XXXXXXXXX"
                  className={cn(INPUT, resetUser && 'opacity-60')} dir="ltr" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">كلمة المرور الجديدة</label>
                <input type="text" value={resetForm.password}
                  onChange={e => setResetForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="6 أحرف على الأقل"
                  className={INPUT} dir="ltr" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">تأكيد كلمة المرور</label>
                <input type="text" value={resetForm.confirm}
                  onChange={e => setResetForm(p => ({ ...p, confirm: e.target.value }))}
                  placeholder="أعد كتابة كلمة المرور"
                  className={INPUT} dir="ltr" />
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#2563eb,#3b82f6)' }}
                onClick={submitReset}
                disabled={resetLoading}>
                {resetLoading ? 'جاري التغيير...' : 'تغيير كلمة المرور'}
              </button>
              <button className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm transition-all"
                onClick={closeReset}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
