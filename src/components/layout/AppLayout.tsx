import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

const pageTitles: Record<string, string> = {
  '/':           'لوحة التحكم',
  '/my-account': 'حسابي',
  '/inventory':  'الجرد والمخزون',
  '/products':   'إدارة المنتجات',
  '/sales':      'المبيعات',
  '/purchases':  'المشتريات',
  '/returns':    'المرتجعات',
  '/daily':      'اليومية',
  '/settlement': 'تسوية المبيعات',
  '/customers':  'إدارة العملاء',
  '/suppliers':  'إدارة الموردين',
  '/damages':    'الهوالك والتالف',
  '/reports':    'التقارير',
  '/alerts':     'التنبيهات',
  '/expenses':   'المصروفات',
  '/workers':    'العمال',
  '/settings':   'الإعدادات',
  '/warehouses': 'إدارة المخازن',
  '/transfers':  'التحويلات بين المخازن',
  '/showrooms':  'المعارض',
  '/ai':         'المساعد الذكي',
};

const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = pageTitles[location.pathname] || 'النظام';

  return (
    <div className="min-h-screen flex" style={{ background: '#f0f4f8' }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 w-full">
        <Header onMenuClick={() => setSidebarOpen(true)} title={title} />
        <main className="flex-1 p-4 md:p-5 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
