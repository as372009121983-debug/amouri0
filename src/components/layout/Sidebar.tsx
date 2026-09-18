import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Package, BarChart3, Bell, Settings, X,
  Archive, ShoppingCart, ShoppingBag, RotateCcw, BookOpen,
  Users, Truck, ReceiptText, UserCheck, AlertTriangle,
  CreditCard, LogOut, Store, CheckCircle2, Crown, Sparkles,
} from 'lucide-react';
import { useInteraction } from '@/hooks/useInteraction';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface SidebarProps { open: boolean; onClose: () => void; }

const allNavItems = [
  { path: '/',            icon: LayoutDashboard, label: 'الرئيسية',         roles: ['admin','warehouse_manager','driver','boss','worker'] },
  { path: '/inventory',   icon: Archive,          label: 'الجرد والمخزون',  roles: ['admin','warehouse_manager','boss'] },
  { path: '/products',    icon: Package,          label: 'المنتجات',        roles: ['admin','warehouse_manager','boss'] },
  { path: '/showrooms',   icon: Store,            label: 'المعارض',         roles: ['admin','warehouse_manager','boss'] },
  { path: '/sales',       icon: ShoppingCart,     label: 'المبيعات',        roles: ['admin','warehouse_manager','worker','boss'] },
  { path: '/purchases',   icon: ShoppingBag,      label: 'المشتريات',       roles: ['admin','warehouse_manager','worker','boss'] },
  { path: '/returns',     icon: RotateCcw,        label: 'المرتجعات',       roles: ['admin','warehouse_manager','boss'] },
  { path: '/daily',       icon: BookOpen,         label: 'اليومية',         roles: ['admin','warehouse_manager','boss'] },
  { path: '/settlement',  icon: CheckCircle2,     label: 'تسوية المبيعات',  roles: ['admin','warehouse_manager','boss'] },
  { path: '/customers',   icon: Users,            label: 'العملاء',         roles: ['admin','warehouse_manager','boss'] },
  { path: '/suppliers',   icon: Truck,            label: 'الموردين',        roles: ['admin','warehouse_manager','boss'] },
  { path: '/expenses',    icon: ReceiptText,      label: 'المصروفات',       roles: ['admin','warehouse_manager','worker','boss'] },
  { path: '/damages',     icon: AlertTriangle,    label: 'الهوالك والتالف', roles: ['admin','warehouse_manager','boss'] },
  { path: '/workers',     icon: UserCheck,        label: 'العمال',          roles: ['admin','warehouse_manager','boss'] },
  { path: '/reports',     icon: BarChart3,        label: 'التقارير',        roles: ['admin','warehouse_manager','boss'] },

  { path: '/alerts',      icon: Bell,             label: 'التنبيهات',       roles: ['admin','warehouse_manager','boss'] },
  { path: '/ai',          icon: Sparkles,         label: 'المساعد الذكي',   roles: ['admin','warehouse_manager','driver','boss','worker'] },
  { path: '/my-account',  icon: CreditCard,       label: 'حسابي',           roles: ['worker'] },
  { path: '/settings',    icon: Settings,         label: 'الإعدادات',       roles: ['admin','warehouse_manager'] },
  { path: '/users',       icon: Crown,            label: 'إدارة المستخدمين', roles: ['admin','warehouse_manager','boss','worker','driver'] },
];

const GROUPS = [
  { label: 'المخزن',    paths: ['/', '/inventory', '/products', '/showrooms'], color: '#dfb246' },
  { label: 'التجارة',   paths: ['/sales', '/purchases', '/returns', '/daily', '/settlement', '/customers', '/suppliers', '/expenses'], color: '#60a5fa' },
  { label: 'الإدارة',   paths: ['/damages', '/workers', '/reports', '/ai', '/alerts', '/my-account', '/settings', '/users'], color: '#a78bfa' },
];

const Sidebar = ({ open, onClose }: SidebarProps) => {
  const { interact } = useInteraction();
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const role = profile?.role || 'worker';

  const roleLabel: Record<string, string> = {
    admin: 'مدير النظام', warehouse_manager: 'مدير مخزن',
    driver: 'سائق', worker: 'عامل', boss: 'الرئيس',
  };

  const navItems = allNavItems.filter(item => {
    // صفحة إدارة المستخدمين تظهر فقط لصاحب الحساب 01278764440
    if (item.path === '/users') {
      const userEmail = profile?.email || '';
      return userEmail === '01278764440@wms.local';
    }
    return item.roles.includes(role);
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['alerts-unread'],
    queryFn: async () => {
      const { count } = await supabase
        .from('alerts')
        .select('*', { count: 'exact', head: true })
        .eq('read', false);
      return count ?? 0;
    },
    refetchInterval: 30000,
    enabled: role !== 'worker',
  });

  const getGroupItems = (paths: string[]) =>
    navItems.filter(item => paths.includes(item.path));

  return (
    <>
      {/* Overlay — shown whenever the sidebar is open, on any screen size */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}
          onClick={() => { interact('click'); onClose(); }}
        />
      )}

      {/* Sidebar panel — visibility is controlled solely by the `open` state (toggled via its button), never by screen size */}
      <aside className={cn(
        'fixed top-0 right-0 h-full w-64 z-50 flex flex-col transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )} style={{ background: '#0f172a', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>

        {/* ── Brand Header ── */}
        <div className="flex items-center justify-between px-4 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)', boxShadow: '0 4px 12px rgba(169,122,31,0.4)' }}>
              <Package className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <p className="font-black text-sm text-white leading-tight">العموري</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(148,163,184,0.7)' }}>لقطع غيار السيارات بالدلنجات</p>
            </div>
          </div>
          <button
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
            onClick={() => { interact('click'); onClose(); }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 py-2 overflow-y-auto scrollbar-thin">
          {GROUPS.map(group => {
            const items = getGroupItems(group.paths);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-1">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: group.color }} />
                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.55)' }}>
                    {group.label}
                  </p>
                </div>
                <ul className="space-y-0.5 px-2">
                  {items.map(item => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    const isAlerts = item.path === '/alerts';
                    return (
                      <li key={item.path}>
                        <NavLink
                          to={item.path}
                          onClick={() => { interact('click'); onClose(); }}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150',
                          )}
                          style={{
                            color: isActive ? '#ffffff' : '#94a3b8',
                            background: isActive
                              ? 'linear-gradient(135deg, rgba(169,122,31,0.85) 0%, rgba(223,178,70,0.75) 100%)'
                              : 'transparent',
                            boxShadow: isActive ? '0 2px 8px rgba(169,122,31,0.25)' : 'none',
                          }}
                          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <div className={cn(
                            'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 relative transition-colors',
                            isActive ? 'bg-white/20' : 'bg-transparent'
                          )}>
                            <Icon className="w-4 h-4" style={{ color: isActive ? '#ffffff' : '#64748b' }} />
                            {isAlerts && (unreadCount as number) > 0 && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold leading-none"
                                style={{ boxShadow: '0 1px 4px rgba(239,68,68,0.5)' }}>
                                {(unreadCount as number) > 9 ? '9+' : unreadCount}
                              </span>
                            )}
                          </div>
                          <span className="flex-1 text-sm leading-none">{item.label}</span>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* ── User Footer ── */}
        <div className="px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
              style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)', boxShadow: '0 2px 8px rgba(169,122,31,0.3)' }}>
              {(profile?.full_name || profile?.username || 'م').charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate leading-tight">
                {profile?.full_name || profile?.username || 'المستخدم'}
              </p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(148,163,184,0.65)' }}>
                {roleLabel[role] || role}
              </p>
            </div>
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#64748b' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.15)'; (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#64748b'; }}
              onClick={async () => { interact('click'); await signOut(); navigate('/login'); }}
              title="تسجيل الخروج">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
