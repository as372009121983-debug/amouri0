import { type ReactNode, useState, useCallback, useEffect } from 'react';
import SplashScreen from '@/components/features/SplashScreen';
import LicenseLockScreen from '@/components/features/LicenseLockScreen';
import { verifyLicense, type LicenseStatus } from '@/lib/license';
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { canAccessRoute } from "@/lib/permissions";
import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import Products from "@/pages/Products";
import Reports from "@/pages/Reports";
import Alerts from "@/pages/Alerts";
import Settings from "@/pages/Settings";
import Sales from "@/pages/Sales";
import Purchases from "@/pages/Purchases";
import Returns from "@/pages/Returns";
import Daily from "@/pages/Daily";
import Customers from "@/pages/Customers";
import Suppliers from "@/pages/Suppliers";
import Login from "@/pages/Login";
import EmployeeLogin from "@/pages/EmployeeLogin";
import Expenses from "@/pages/Expenses";
import Workers from "@/pages/Workers";
import Damages from "@/pages/Damages";
import WorkerSelf from "@/pages/WorkerSelf";
import Showrooms from "@/pages/Showrooms";
import Transfers from "@/pages/Transfers";
import Warehouses from "@/pages/Warehouses";
import CustomerDetail from "@/pages/CustomerDetail";
import SupplierDetail from "@/pages/SupplierDetail";
import ShowroomDetail from "@/pages/ShowroomDetail";
import UserManagement from "@/pages/UserManagement";
import DailySettlement from "@/pages/DailySettlement";
import AIAssistant from "@/pages/AIAssistant";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30000,
      refetchOnWindowFocus: false,
      // تحسين الأداء: تجنب إعادة الجلب التلقائية المتكررة
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 1,
    },
  },
});

/* ══ شاشة تحميل موحّدة ══ */
const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: '#f0f4f8' }}>
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-2xl animate-pulse" style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }} />
      <p className="text-slate-400 text-sm font-medium">جاري التحميل...</p>
    </div>
  </div>
);

/* ══ صفحة ممنوع الوصول ══ */
const AccessDenied = () => {
  const { profile } = useAuth();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-4">
        <span className="text-3xl">🔒</span>
      </div>
      <h1 className="text-xl font-black text-slate-800 mb-2">ليس لديك صلاحية</h1>
      <p className="text-sm text-slate-500 mb-1">هذه الصفحة غير متاحة لدورك الوظيفي</p>
      <p className="text-xs text-slate-400 mb-6">
        دورك الحالي: <span className="font-bold text-slate-600">{profile?.role || '—'}</span>
      </p>
      <button
        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: 'linear-gradient(135deg,#a97a1f,#dfb246)' }}
        onClick={() => window.history.back()}
      >
        العودة للخلف
      </button>
    </div>
  );
};

/* ══ مسار محمي بمصادقة ══ */
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
};

/* ══ مسار محمي بصلاحيات الدور ══ */
const RoleRoute = ({ children, path }: { children: ReactNode; path: string }) => {
  const { profile, loading } = useAuth();

  // انتظر تحميل الملف الشخصي
  if (loading || !profile) return <LoadingScreen />;

  // تحقق من الصلاحية
  if (!canAccessRoute(profile.role, path)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
};

/* ══ مسار محمي لصاحب الحساب الرئيسي فقط (إدارة المستخدمين) ══ */
const OwnerOnlyRoute = ({ children }: { children: ReactNode }) => {
  const { profile, loading } = useAuth();
  if (loading || !profile) return <LoadingScreen />;
  const isOwner = profile.email === '01278764440@wms.local';
  if (!isOwner) return <AccessDenied />;
  return <>{children}</>;
};

/* ══ إعادة توجيه بحسب الدور عند الدخول ══ */
const HomeRedirect = () => {
  const { profile } = useAuth();
  if (!profile) return <LoadingScreen />;

  // العامل يذهب للمبيعات مباشرة
  if (profile.role === 'worker') return <Navigate to="/sales" replace />;
  // السائق يذهب للتحويلات
  if (profile.role === 'driver') return <Navigate to="/transfers" replace />;
  // الباقون يذهبون للوحة التحكم
  return <Dashboard />;
};

const AppRoutes = () => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      {/* ─ صفحات عامة ─ */}
      <Route path="/login"          element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/employee-login" element={user ? <Navigate to="/" replace /> : <EmployeeLogin />} />

      {/* ─ صفحات محمية ─ */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>

        {/* لوحة التحكم */}
        <Route path="/" element={<HomeRedirect />} />

        {/* المخزن */}
        <Route path="/inventory"    element={<RoleRoute path="/inventory"><Inventory /></RoleRoute>} />
        <Route path="/products"     element={<RoleRoute path="/products"><Products /></RoleRoute>} />
        <Route path="/warehouses"   element={<RoleRoute path="/warehouses"><Warehouses /></RoleRoute>} />
        <Route path="/transfers"    element={<RoleRoute path="/transfers"><Transfers /></RoleRoute>} />
        <Route path="/showrooms"    element={<RoleRoute path="/showrooms"><Showrooms /></RoleRoute>} />
        <Route path="/showrooms/:id" element={<RoleRoute path="/showrooms/:id"><ShowroomDetail /></RoleRoute>} />

        {/* التجارة */}
        <Route path="/sales"        element={<RoleRoute path="/sales"><Sales /></RoleRoute>} />
        <Route path="/purchases"    element={<RoleRoute path="/purchases"><Purchases /></RoleRoute>} />
        <Route path="/returns"      element={<RoleRoute path="/returns"><Returns /></RoleRoute>} />
        <Route path="/daily"        element={<RoleRoute path="/daily"><Daily /></RoleRoute>} />
        <Route path="/settlement"   element={<RoleRoute path="/settlement"><DailySettlement /></RoleRoute>} />
        <Route path="/customers"    element={<RoleRoute path="/customers"><Customers /></RoleRoute>} />
        <Route path="/customers/:id" element={<RoleRoute path="/customers/:id"><CustomerDetail /></RoleRoute>} />
        <Route path="/suppliers"    element={<RoleRoute path="/suppliers"><Suppliers /></RoleRoute>} />
        <Route path="/suppliers/:id" element={<RoleRoute path="/suppliers/:id"><SupplierDetail /></RoleRoute>} />
        <Route path="/expenses"     element={<RoleRoute path="/expenses"><Expenses /></RoleRoute>} />

        {/* الإدارة */}
        <Route path="/damages"      element={<RoleRoute path="/damages"><Damages /></RoleRoute>} />
        <Route path="/workers"      element={<RoleRoute path="/workers"><Workers /></RoleRoute>} />
        <Route path="/reports"      element={<RoleRoute path="/reports"><Reports /></RoleRoute>} />

        <Route path="/alerts"       element={<RoleRoute path="/alerts"><Alerts /></RoleRoute>} />
        <Route path="/ai"          element={<RoleRoute path="/ai"><AIAssistant /></RoleRoute>} />
        <Route path="/settings"     element={<RoleRoute path="/settings"><Settings /></RoleRoute>} />
        <Route path="/my-account"   element={<RoleRoute path="/my-account"><WorkerSelf /></RoleRoute>} />
        <Route path="/users"        element={<OwnerOnlyRoute><UserManagement /></OwnerOnlyRoute>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => {
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashDone = useCallback(() => setSplashDone(true), []);
  const [license, setLicense] = useState<LicenseStatus>('checking');

  useEffect(() => {
    if (localStorage.getItem('wms_dark_mode') === '1') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    verifyLicense().then((status) => { if (alive) setLicense(status); });
    return () => { alive = false; };
  }, []);

  if (license === 'checking') {
    return <LoadingScreen />;
  }
  if (license !== 'valid') {
    return <LicenseLockScreen status={license} />;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          {!splashDone && <SplashScreen onDone={handleSplashDone} />}
          <BrowserRouter>
            <AuthProvider>
              <ErrorBoundary>
                <AppRoutes />
              </ErrorBoundary>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
