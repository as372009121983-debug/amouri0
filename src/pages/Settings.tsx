import { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, User, Bell, Shield, Save, Volume2, VolumeX, Lock, Eye, EyeOff, Trash2, Smartphone, Download, Upload, HardDrive, Building2, Moon, Sun } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile, UserRole } from '@/lib/supabase';

const roleLabel: Record<string, string> = {
  admin: 'مدير النظام',
  warehouse_manager: 'مدير مخزن',
  driver: 'سائق',
  worker: 'عامل',
  boss: 'الرئيس',
};

// PWA install prompt type
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const Settings = () => {
  const { interact } = useInteraction();
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === 'admin';

  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [lowStockAlert, setLowStockAlert] = useState(true);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [deferredInstall, setDeferredInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBackupReminder, setShowBackupReminder] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const [companyForm, setCompanyForm] = useState(() => {
    try { const s = localStorage.getItem('wms_company_info'); if (s) return JSON.parse(s); } catch { /* noop */ }
    return { name: 'العموري', subname: 'لقطع غيار السيارات بالدلنجات', phone: '01000000000', address: 'القاهرة، مصر', thanks: 'شكرًا لثقتكم' };
  });

  const handleDarkMode = (enabled: boolean) => {
    setDarkMode(enabled);
    if (enabled) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('wms_dark_mode', '1');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('wms_dark_mode', '0');
    }
    interact('click');
  };

  const saveCompanyInfo = () => {
    localStorage.setItem('wms_company_info', JSON.stringify(companyForm));
    toast.success('تم حفظ بيانات الشركة — ستظهر في الفواتير المطبوعة');
    interact('success');
  };

  const [editProfile, setEditProfile] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
  });

  // ─── Backup ───────────────────────────────────────────────────────────────
  const handleBackup = async () => {
    setBackupLoading(true);
    interact('click');
    try {
      const tables = [
        'warehouses', 'products', 'inventory', 'customers', 'suppliers',
        'sales', 'sale_items', 'purchases', 'purchase_items',
        'transfers', 'transfer_items', 'returns', 'return_items',
        'expenses', 'damages', 'alerts',
        'customer_payments', 'supplier_payments', 'worker_transactions',
        'showrooms', 'showroom_inventory',
      ];

      // Fetch all tables in parallel — include all columns
      const results = await Promise.all(
        tables.map(t => supabase.from(t as never).select('*').limit(50000).then(r => ({ table: t, data: r.data || [], error: r.error })))
      );

      const backup: Record<string, unknown> = {
        _version: 3,
        _date: new Date().toISOString(),
        _app: 'WMS-العموري',
        _tables: tables,
        _profile: {
          id: profile?.id,
          email: profile?.email,
          role: profile?.role,
        },
      };

      // جلب بيانات user_profiles بشكل منفصل (يحتاج صلاحيات خاصة)
      const { data: usersData } = await supabase.from('user_profiles')
        .select('id, username, email, role, full_name, phone, active, max_salary, hire_date, owner_id')
        .limit(1000);
      backup['user_profiles_meta'] = usersData || [];

      results.forEach(r => {
        backup[r.table] = r.data;
        if (r.error) console.warn(`Backup warning [${r.table}]:`, r.error.message);
      });

      // Statistics
      const totalRows = results.reduce((s, r) => s + (r.data as unknown[]).length, 0);
      console.log('Backup total rows:', totalRows);

      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      a.download = `WMS-backup-v3-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save backup date
      localStorage.setItem('wms_last_backup_date', new Date().toISOString());
      setShowBackupReminder(false);

      toast.success(`تم حفظ النسخة الشاملة — ${totalRows.toLocaleString('ar-EG')} سجل من ${tables.length} جدول`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'حدث خطأ أثناء النسخ');
    } finally {
      setBackupLoading(false);
    }
  };

  // ─── Restore (via Edge Function with service role — lossless) ──────────────
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input immediately so it can be re-used
    e.target.value = '';

    const confirmed = window.confirm('سيتم استبدال البيانات الحالية بالنسخة الاحتياطية بالكامل. هل أنت متأكد؟');
    if (!confirmed) return;

    setRestoreLoading(true);
    interact('click');

    try {
      const text = await file.text();
      let backup: Record<string, unknown>;
      try {
        backup = JSON.parse(text);
      } catch {
        throw new Error('الملف غير صالح — تأكد أنه ملف JSON صحيح');
      }

      if (!backup._version) throw new Error('ملف النسخة الاحتياطية غير صالح — لا يوجد إصدار');

      toast.info('جاري رفع البيانات للاستعادة...');

      // Send backup to edge function — service role bypasses RLS, zero field stripping
      const { data, error } = await supabase.functions.invoke('restore-backup', {
        body: backup,
      });

      if (error) {
        let msg = error.message;
        try {
          // @ts-ignore
          const txt = await error.context?.text?.();
          if (txt) msg = txt;
        } catch { /* noop */ }
        throw new Error(msg);
      }

      const result = data as { success: boolean; restored: number; skipped: number; insertErrors: string[]; deleteErrors: string[] };

      qc.clear();

      if (result.skipped > 0) {
        const errSummary = (result.insertErrors || []).slice(0, 3).join(' | ');
        console.warn('Restore insert errors:', result.insertErrors);
        toast.warning(
          `تمت استعادة ${result.restored.toLocaleString('ar-EG')} سجل بنجاح — تعذّر ${result.skipped} سجل${errSummary ? `\n${errSummary}` : ''}`,
          { duration: 8000 }
        );
        // Still reload if some records were restored
        if (result.restored > 0) setTimeout(() => window.location.reload(), 3000);
      } else {
        toast.success(
          `تمت استعادة ${result.restored.toLocaleString('ar-EG')} سجل بالكامل — جاري تحديث الصفحة`,
          { duration: 4000 }
        );
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (e: unknown) {
      console.error('Restore fatal error:', e);
      toast.error(e instanceof Error ? e.message : 'خطأ غير متوقع أثناء الاستعادة');
    } finally {
      setRestoreLoading(false);
    }
  };

  // ─── Backup Reminder Check ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    const lastBackup = localStorage.getItem('wms_last_backup_date');
    if (!lastBackup) {
      // Never backed up
      setShowBackupReminder(true);
      return;
    }
    const daysSince = Math.floor((Date.now() - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 7) {
      setShowBackupReminder(true);
    }
  }, [isAdmin]);

  // PWA install detection
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredInstall(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }
    window.addEventListener('appinstalled', () => setIsInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPWA = async () => {
    interact('click');
    if (deferredInstall) {
      await deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') {
        toast.success('تم إضافة التطبيق للشاشة الرئيسية');
        setDeferredInstall(null);
        setIsInstalled(true);
      }
    } else {
      // iOS / already installed guidance
      toast.info('لإضافة التطبيق: افتح قائمة المشاركة في Safari ثم اختر "إضافة إلى الشاشة الرئيسية"');
    }
  };

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await supabase.from('user_profiles').select('*').order('role');
      if (error) throw error;
      return data as UserProfile[];
    },
    enabled: isAdmin,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const { error } = await supabase.from('user_profiles').update({ full_name: editProfile.full_name, phone: editProfile.phone }).eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: () => { refreshProfile(); interact('success'); toast.success('تم حفظ التغييرات'); },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { error } = await supabase.from('user_profiles').update({ role }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); interact('success'); toast.success('تم تحديث الصلاحية'); },
  });

  const changePwdMutation = useMutation({
    mutationFn: async () => {
      if (pwdForm.next.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      if (pwdForm.next !== pwdForm.confirm) throw new Error('كلمتا المرور غير متطابقتين');
      if (!profile?.email) throw new Error('لا يمكن التحقق من الحساب');
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: pwdForm.current });
      if (signErr) throw new Error('كلمة المرور الحالية غير صحيحة');
      const { error } = await supabase.auth.updateUser({ password: pwdForm.next });
      if (error) throw error;
    },
    onSuccess: () => {
      interact('success');
      toast.success('تم تغيير كلمة المرور بنجاح');
      setShowPwdModal(false);
      setPwdForm({ current: '', next: '', confirm: '' });
    },
    onError: (e: Error) => { interact('error'); toast.error(e.message); },
  });

  // Clear all business data
  const handleClearAllData = async () => {
    if (clearConfirmText !== 'مسح البيانات') {
      toast.error('يرجى كتابة "مسح البيانات" للتأكيد');
      return;
    }
    setClearLoading(true);
    interact('delete');
    try {
      // Delete in correct order to avoid FK constraints
      const tables = [
        'return_items', 'returns',
        'sale_items', 'sales',
        'purchase_items', 'purchases',
        'transfer_items', 'transfers',
        'worker_transactions',
        'customer_payments', 'supplier_payments',
        'expenses',
        'damages',
        'alerts',
        'inventory',
        'customers',
        'suppliers',
        'products',
        'warehouses',
      ];

      for (const table of tables) {
        const { error } = await supabase.from(table as never).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) console.error(`Error clearing ${table}:`, error.message);
      }

      // Invalidate all queries
      qc.clear();
      toast.success('تم مسح جميع البيانات بنجاح');
      setShowClearModal(false);
      setClearConfirmText('');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'حدث خطأ أثناء المسح');
    } finally {
      setClearLoading(false);
    }
  };

  const Toggle = ({ value, onChange, label, desc }: { value: boolean; onChange: () => void; label: string; desc?: string }) => (
    <div className="flex items-center justify-between py-3 border-b border-border/50">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button
        className={cn('relative w-12 h-6 rounded-full transition-all duration-300', value ? 'gradient-blue glow-blue' : 'bg-white/10')}
        onClick={() => { interact('click'); onChange(); }}
      >
        <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300', value ? 'right-1' : 'left-1')} />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Backup Reminder Banner */}
      {isAdmin && showBackupReminder && (
        <div className="glass rounded-2xl p-4 border border-amber-500/40 animate-fade-up" style={{ background: 'rgba(217,119,6,0.08)' }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)' }}>
              <HardDrive className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-amber-600 text-sm">⚠ تذكير: لم تأخذ نسخة احتياطية منذ أكثر من 7 أيام</p>
              <p className="text-xs text-amber-500 mt-0.5">يُنصح بأخذ نسخة احتياطية دورية لحماية بياناتك</p>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg"
                style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)' }}
                onClick={handleBackup}
                disabled={backupLoading}>
                {backupLoading ? 'جاري...' : 'نسخ الآن'}
              </button>
              <button className="px-3 py-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg" onClick={() => setShowBackupReminder(false)}>تذكيرني لاحقاً</button>
            </div>
          </div>
        </div>
      )}

      {/* Company Info */}
      {isAdmin && (
        <div className="glass rounded-2xl p-5 border border-border animate-fade-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 gradient-blue rounded-xl flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">بيانات الشركة / المنشأة</h2>
              <p className="text-xs text-muted-foreground">تظهر في رأس وتذييل جميع الفواتير المطبوعة</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ label: 'اسم الشركة', key: 'name', placeholder: 'مثال: العموري' }, { label: 'الوصف / التخصص', key: 'subname', placeholder: 'مثال: نظام إدارة المخازن' }, { label: 'رقم الهاتف', key: 'phone', placeholder: '01XXXXXXXXX' }, { label: 'العنوان', key: 'address', placeholder: 'القاهرة، مصر' }, { label: 'رسالة الشكر', key: 'thanks', placeholder: 'شكرًا لثقتكم' }].map(f => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{f.label}</label>
                <input type="text" value={companyForm[f.key as keyof typeof companyForm]}
                  onChange={e => setCompanyForm((p: typeof companyForm) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="bg-card border border-border rounded-xl py-2.5 px-3 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
            ))}
          </div>
          <button className="mt-4 icon-btn gap-2 gradient-blue text-white px-4 py-2.5 rounded-xl text-sm font-semibold w-full sm:w-auto"
            onClick={saveCompanyInfo}>
            <Save className="w-4 h-4" /><span>حفظ بيانات الشركة</span>
          </button>
        </div>
      )}

      {/* Profile */}
      <div className="glass rounded-2xl p-5 border border-border animate-fade-up">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 gradient-blue rounded-xl flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          <h2 className="font-bold text-foreground">معلومات الحساب</h2>
        </div>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 gradient-emerald rounded-2xl flex items-center justify-center flex-shrink-0 glow-emerald">
            <span className="text-white text-2xl font-bold">{(profile?.full_name || profile?.username || 'م')[0]}</span>
          </div>
          <div>
            <p className="font-bold text-foreground">{profile?.full_name || profile?.username}</p>
            <p className="text-sm text-muted-foreground">{profile?.phone || profile?.email}</p>
            <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/20">
              {roleLabel[profile?.role || ''] || profile?.role}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">الاسم الكامل</label>
            <input type="text" value={editProfile.full_name} onChange={e => setEditProfile(p => ({ ...p, full_name: e.target.value }))}
              className="bg-card border border-border rounded-xl py-2.5 px-3 text-sm text-foreground focus:outline-none focus:border-primary/50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">رقم الجوال</label>
            <input type="text" value={editProfile.phone} onChange={e => setEditProfile(p => ({ ...p, phone: e.target.value }))}
              className="bg-card border border-border rounded-xl py-2.5 px-3 text-sm text-foreground focus:outline-none focus:border-primary/50" />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button className="flex-1 icon-btn gap-2 gradient-blue text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
            onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending}>
            <Save className="w-4 h-4" /><span>حفظ التغييرات</span>
          </button>
          <button className="icon-btn gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-100"
            onClick={() => { interact('click'); setShowPwdModal(true); }}>
            <Lock className="w-4 h-4" /><span>تغيير كلمة المرور</span>
          </button>
        </div>
      </div>

      {/* PWA Install */}
      <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '30ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 gradient-blue rounded-xl flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-white" />
          </div>
          <h2 className="font-bold text-foreground">تطبيق الهاتف</h2>
        </div>
        {isInstalled ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-sm text-emerald-700 font-medium flex items-center gap-2">
              <span>✓</span> التطبيق مثبت على الشاشة الرئيسية
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">أضف التطبيق للشاشة الرئيسية للوصول السريع وتجربة أفضل بدون متصفح.</p>
            <button
              className="w-full icon-btn gap-2 gradient-blue text-white px-4 py-3 rounded-xl text-sm font-semibold"
              onClick={handleInstallPWA}>
              <Download className="w-4 h-4" />
              <span>إضافة للشاشة الرئيسية</span>
            </button>
            <p className="text-xs text-muted-foreground text-center">
              على iOS: افتح Safari → أيقونة المشاركة → "إضافة إلى الشاشة الرئيسية"
            </p>
          </div>
        )}
      </div>

      {/* User Management (admin only) */}
      {isAdmin && (
        <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 gradient-violet rounded-xl flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <h2 className="font-bold text-foreground">إدارة المستخدمين</h2>
          </div>

          <div className="space-y-2">
            {users.map((u: UserProfile, i: number) => (
              <div key={u.id} className={cn('flex items-center justify-between p-3 rounded-xl glass border border-border animate-fade-up', u.id === profile?.id && 'border-primary/25')}
                style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 gradient-emerald rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">{(u.full_name || u.username || u.email)[0]}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{u.full_name || u.username}</p>
                    <p className="text-xs text-muted-foreground">{u.phone || u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.id !== profile?.id ? (
                    <select value={u.role}
                      onChange={e => updateRoleMutation.mutate({ id: u.id, role: e.target.value as UserRole })}
                      className="bg-card border border-border rounded-lg py-1.5 px-2 text-xs text-foreground focus:outline-none focus:border-primary/50">
                      <option value="admin">مدير النظام</option>
                      <option value="warehouse_manager">مدير مخزن</option>
                      <option value="driver">سائق</option>
                      <option value="worker">عامل</option>
                      <option value="boss">الرئيس</option>
                    </select>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-blue-500/15 text-blue-400 rounded-lg border border-blue-500/20">أنت</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password Change Modal */}
      {showPwdModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-md rounded-2xl border border-border p-6 animate-fade-up">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 gradient-amber rounded-xl flex items-center justify-center">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-lg font-bold text-foreground">تغيير كلمة المرور</h2>
            </div>
            <div className="space-y-3">
              {[{ key: 'current', label: 'كلمة المرور الحالية' }, { key: 'next', label: 'كلمة المرور الجديدة' }, { key: 'confirm', label: 'تأكيد كلمة المرور الجديدة' }].map(f => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{f.label}</label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={pwdForm[f.key as keyof typeof pwdForm]}
                      onChange={e => setPwdForm(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-10 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                    {f.key === 'confirm' && (
                      <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPwd(!showPwd)}>
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button className="flex-1 gradient-blue text-white rounded-xl py-2.5 font-semibold"
                onClick={() => changePwdMutation.mutate()}
                disabled={changePwdMutation.isPending}>
                {changePwdMutation.isPending ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}
              </button>
              <button className="flex-1 glass text-muted-foreground rounded-xl py-2.5"
                onClick={() => { interact('click'); setShowPwdModal(false); setPwdForm({ current: '', next: '', confirm: '' }); }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sound & Vibration */}
      <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 gradient-violet rounded-xl flex items-center justify-center">
            {sound ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-white" />}
          </div>
          <h2 className="font-bold text-foreground">الصوت والاهتزاز</h2>
        </div>
        <Toggle value={sound} onChange={() => setSound(!sound)} label="تفعيل الأصوات التفاعلية" desc="أصوات عند الضغط على الأزرار" />
        <Toggle value={vibration} onChange={() => setVibration(!vibration)} label="تفعيل الاهتزاز" desc="اهتزاز الجهاز عند الإجراءات" />
        {/* Dark mode */}
        <div className="flex items-center justify-between py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            {darkMode ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
            <div>
              <p className="text-sm font-medium text-foreground">الوضع الداكن</p>
              <p className="text-xs text-muted-foreground mt-0.5">تغيير مظهر التطبيق</p>
            </div>
          </div>
          <button
            className={cn('relative w-12 h-6 rounded-full transition-all duration-300', darkMode ? 'bg-indigo-600' : 'bg-white/10')}
            onClick={() => handleDarkMode(!darkMode)}
          >
            <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-300', darkMode ? 'right-1' : 'left-1')} />
          </button>
        </div>
        <div className="mt-3 pt-3">
          <p className="text-xs text-muted-foreground mb-3">اختبار التفاعل</p>
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'نقرة', type: 'click' as const, color: 'text-blue-400' },
              { label: 'نجاح', type: 'success' as const, color: 'text-emerald-400' },
              { label: 'تحذير', type: 'warning' as const, color: 'text-amber-400' },
              { label: 'تحويل', type: 'transfer' as const, color: 'text-violet-400' },
            ].map(({ label, type, color }) => (
              <button key={type} className={cn('icon-btn px-3 py-2 glass text-sm rounded-xl border border-border hover:border-primary/30', color)}
                onClick={() => interact(type)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 gradient-amber rounded-xl flex items-center justify-center">
            <Bell className="w-4 h-4 text-white" />
          </div>
          <h2 className="font-bold text-foreground">إعدادات التنبيهات</h2>
        </div>
        <Toggle value={lowStockAlert} onChange={() => setLowStockAlert(!lowStockAlert)} label="تنبيهات نفاد المخزون" desc="إشعار عند انخفاض الكميات" />
      </div>

      {/* System Info */}
      <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '300ms' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 gradient-red rounded-xl flex items-center justify-center">
            <SettingsIcon className="w-4 h-4 text-white" />
          </div>
          <h2 className="font-bold text-foreground">معلومات النظام</h2>
        </div>
        <div className="space-y-2">
          {[['الإصدار', 'v3.1.0'], ['قاعدة البيانات', 'OnSpace Cloud'], ['اللغة', 'العربية'], ['آخر تحديث', new Date().toLocaleDateString('ar-SA')]].map(([label, value]) => (
            <div key={label} className="flex justify-between py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-sm text-foreground font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="glass rounded-2xl p-5 border border-border animate-fade-up" style={{ animationDelay: '350ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 gradient-blue rounded-xl flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-foreground">النسخ الاحتياطي والاستعادة</h2>
              <p className="text-xs text-muted-foreground">حفظ كامل بياناتك واستعدها بضغطة واحدة</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3">
              <p className="text-xs text-blue-400">ℹ️ يشمل المخازن | المنتجات | المبيعات | المشتريات | العملاء | الموردين | المصروفات | التحويلات | المرتجعات | المعارض | جميع السجلات.</p>
            </div>
            <button
              className="w-full icon-btn gap-2 gradient-blue text-white px-4 py-3 rounded-xl text-sm font-semibold"
              onClick={handleBackup}
              disabled={backupLoading}>
              <Download className="w-4 h-4" />
              <span>{backupLoading ? 'جاري جمع البيانات...' : 'تنزيل نسخة احتياطية شاملة'}</span>
            </button>
            <button
              className="w-full icon-btn gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 px-4 py-3 rounded-xl text-sm font-semibold"
              onClick={() => restoreFileRef.current?.click()}
              disabled={restoreLoading}>
              <Upload className="w-4 h-4" />
              <span>{restoreLoading ? 'جاري الاستعادة...' : 'استعادة من نسخة احتياطية'}</span>
            </button>
            <input ref={restoreFileRef} type="file" accept=".json" className="hidden" onChange={handleRestore} />
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {isAdmin && (
        <div className="glass rounded-2xl p-5 border border-red-500/30 animate-fade-up" style={{ animationDelay: '400ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-red-500 rounded-xl flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-red-400">منطقة الخطر</h2>
              <p className="text-xs text-muted-foreground">إجراءات لا يمكن التراجع عنها</p>
            </div>
          </div>
          <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 mb-4">
            <p className="text-xs text-red-400">
              ⚠ سيؤدي مسح البيانات إلى حذف جميع المبيعات والمشتريات والمخزون والعملاء والموردين والمصروفات نهائياً. لن يتم حذف حسابات المستخدمين.
            </p>
          </div>
          <button
            className="w-full icon-btn gap-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-4 py-3 rounded-xl text-sm font-semibold"
            onClick={() => { interact('click'); setShowClearModal(true); setClearConfirmText(''); }}>
            <Trash2 className="w-4 h-4" />
            <span>مسح جميع بيانات التطبيق</span>
          </button>
        </div>
      )}

      {/* Clear Data Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-background w-full max-w-md rounded-2xl border border-red-500/40 p-6 animate-fade-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-500/20 rounded-2xl flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-red-400">تأكيد مسح البيانات</h2>
                <p className="text-xs text-muted-foreground">هذا الإجراء لا يمكن التراجع عنه</p>
              </div>
            </div>

            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
              <p className="text-sm text-red-300 leading-relaxed">
                سيتم حذف: المبيعات، المشتريات، المخزون، العملاء، الموردين، المنتجات، المخازن، المصروفات، التحويلات، المرتجعات، السلف.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 mb-4">
              <label className="text-xs text-muted-foreground">
                اكتب <span className="text-red-400 font-bold">"مسح البيانات"</span> للتأكيد:
              </label>
              <input
                type="text"
                value={clearConfirmText}
                onChange={e => setClearConfirmText(e.target.value)}
                placeholder='مسح البيانات'
                className="bg-card border border-red-500/30 rounded-xl py-2.5 px-3 text-sm text-foreground focus:outline-none focus:border-red-500/60"
              />
            </div>

            <div className="flex gap-3">
              <button
                className={cn(
                  'flex-1 py-2.5 rounded-xl font-bold text-sm transition-all',
                  clearConfirmText === 'مسح البيانات'
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-red-500/20 text-red-400/50 cursor-not-allowed'
                )}
                onClick={handleClearAllData}
                disabled={clearConfirmText !== 'مسح البيانات' || clearLoading}>
                {clearLoading ? 'جاري المسح...' : 'مسح جميع البيانات'}
              </button>
              <button className="flex-1 glass text-muted-foreground rounded-xl py-2.5"
                onClick={() => { interact('click'); setShowClearModal(false); setClearConfirmText(''); }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
