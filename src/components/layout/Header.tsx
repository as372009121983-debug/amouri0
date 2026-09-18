import { Bell, Menu, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface HeaderProps {
  onMenuClick: () => void;
  title: string;
}

const roleLabel: Record<string, string> = {
  admin: 'مدير النظام', warehouse_manager: 'مدير مخزن',
  driver: 'سائق', worker: 'عامل', boss: 'الرئيس',
};

const Header = ({ onMenuClick, title }: HeaderProps) => {
  const { interact } = useInteraction();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: async () => {
      const { count } = await supabase
        .from('alerts').select('*', { count: 'exact', head: true }).eq('read', false);
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const handleSignOut = async () => {
    interact('click');
    setShowProfile(false);
    await signOut();
    navigate('/login');
  };

  return (
    <header className="h-[60px] flex items-center justify-between px-4 md:px-6 sticky top-0 z-30 flex-shrink-0"
      style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #e8edf2',
        boxShadow: '0 1px 8px rgba(15,23,42,0.05)',
      }}>

      {/* ── Left: menu + page title ── */}
      <div className="flex items-center gap-3">
        <button
          className="icon-btn w-9 h-9 rounded-xl"
          style={{ color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0' }}
          onClick={() => { interact('click'); onMenuClick(); }}
          aria-label="فتح القائمة">
          <Menu className="w-4.5 h-4.5" />
        </button>
        <div>
          <h1 className="text-base font-bold text-slate-800 leading-tight">{title}</h1>
          <p className="text-xs text-slate-400 hidden sm:block leading-none mt-0.5">العموري — لقطع غيار السيارات بالدلنجات</p>
        </div>
      </div>

      {/* ── Right: alerts + profile ── */}
      <div className="flex items-center gap-2">

        {/* Alerts */}
        <button
          className="icon-btn w-9 h-9 rounded-xl relative transition-all"
          style={{
            color: (unreadCount as number) > 0 ? '#d97706' : '#94a3b8',
            background: (unreadCount as number) > 0 ? '#fffbeb' : '#f8fafc',
            border: `1px solid ${(unreadCount as number) > 0 ? '#fde68a' : '#e2e8f0'}`,
          }}
          onClick={() => { interact('click'); navigate('/alerts'); }}
          aria-label="التنبيهات">
          <Bell className="w-4 h-4" />
          {(unreadCount as number) > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold px-0.5 leading-none"
              style={{ boxShadow: '0 1px 4px rgba(239,68,68,0.45)' }}>
              {(unreadCount as number) > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Profile dropdown */}
        <div className="relative">
          <button
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-all"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
            onClick={() => { interact('click'); setShowProfile(v => !v); }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)', boxShadow: '0 2px 6px rgba(169,122,31,0.3)' }}>
              {(profile?.full_name || profile?.username || 'م')[0]}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-slate-800 leading-tight">
                {profile?.full_name || profile?.username || 'المستخدم'}
              </p>
              <p className="text-xs leading-tight" style={{ color: '#94a3b8' }}>
                {roleLabel[profile?.role || ''] || profile?.role || ''}
              </p>
            </div>
            <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 transition-transform hidden sm:block', showProfile && 'rotate-180')} />
          </button>

          {showProfile && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowProfile(false)} />
              <div className="absolute left-0 top-full mt-2 w-56 bg-white rounded-2xl border border-slate-200 z-50 overflow-hidden animate-scale-in"
                style={{ boxShadow: '0 12px 40px rgba(15,23,42,0.15)' }}>
                {/* User info */}
                <div className="p-4 border-b border-slate-100"
                  style={{ background: 'linear-gradient(135deg,#f0fdf9,#f8fafc)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
                      style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}>
                      {(profile?.full_name || profile?.username || 'م')[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {profile?.full_name || profile?.username}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{profile?.email}</p>
                      <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-md font-semibold"
                        style={{ background: '#faf0d4', color: '#a97a1f' }}>
                        {roleLabel[profile?.role || ''] || profile?.role}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="p-1.5">
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
                    onClick={() => { setShowProfile(false); navigate('/settings'); interact('click'); }}>
                    <Settings className="w-4 h-4 text-slate-400" />
                    <span>الإعدادات</span>
                  </button>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    onClick={handleSignOut}>
                    <LogOut className="w-4 h-4" />
                    <span>تسجيل الخروج</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
