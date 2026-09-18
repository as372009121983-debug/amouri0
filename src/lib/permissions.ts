/**
 * ══════════════════════════════════════════
 *  نظام الصلاحيات المركزي — WMS
 * ══════════════════════════════════════════
 *
 * الأدوار:
 *  admin             → كل الصلاحيات
 *  warehouse_manager → إدارة كاملة (عدا حذف النظام وتغيير الأدوار)
 *  boss              → مشاهدة فقط (قراءة + تقارير)
 *  driver            → لوحة التحكم + التحويلات فقط
 *  worker            → إضافة مبيعات/مشتريات/مصروفات فقط، لا حذف ولا تعديل
 */

export type Role = 'admin' | 'warehouse_manager' | 'boss' | 'driver' | 'worker';

// ── تعريف الصفحات المسموح بها لكل دور ──
export const ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/':           ['admin', 'warehouse_manager', 'boss', 'driver', 'worker'],
  '/inventory':  ['admin', 'warehouse_manager', 'boss'],
  '/products':   ['admin', 'warehouse_manager', 'boss'],
  '/showrooms':  ['admin', 'warehouse_manager', 'boss'],
  '/showrooms/:id': ['admin', 'warehouse_manager', 'boss'],
  '/warehouses': ['admin', 'warehouse_manager', 'boss'],
  '/transfers':  ['admin', 'warehouse_manager', 'driver', 'boss'],
  '/sales':      ['admin', 'warehouse_manager', 'worker', 'boss'],
  '/purchases':  ['admin', 'warehouse_manager', 'worker', 'boss'],
  '/returns':    ['admin', 'warehouse_manager', 'boss'],
  '/daily':      ['admin', 'warehouse_manager', 'boss'],
  '/settlement': ['admin', 'warehouse_manager', 'boss'],
  '/customers':  ['admin', 'warehouse_manager', 'boss'],
  '/customers/:id': ['admin', 'warehouse_manager', 'boss'],
  '/suppliers':  ['admin', 'warehouse_manager', 'boss'],
  '/suppliers/:id': ['admin', 'warehouse_manager', 'boss'],
  '/reports':    ['admin', 'warehouse_manager', 'boss'],
  '/alerts':     ['admin', 'warehouse_manager', 'boss'],
  '/expenses':   ['admin', 'warehouse_manager', 'worker', 'boss'],
  '/workers':    ['admin', 'warehouse_manager', 'boss'],
  '/damages':    ['admin', 'warehouse_manager', 'boss'],
  '/settings':   ['admin'],
  '/my-account': ['worker', 'driver'],
  '/ai':         ['admin', 'warehouse_manager', 'boss', 'driver', 'worker'],
};

// ── تعريف الإجراءات (Actions) ──
export type Action =
  // مبيعات
  | 'sales:create'
  | 'sales:edit'
  | 'sales:delete'
  | 'sales:payment'
  | 'sales:print'
  // مشتريات
  | 'purchases:create'
  | 'purchases:edit'
  | 'purchases:delete'
  | 'purchases:payment'
  // منتجات
  | 'products:create'
  | 'products:edit'
  | 'products:delete'
  // مخزون
  | 'inventory:adjust'
  | 'inventory:transfer'
  // عملاء
  | 'customers:create'
  | 'customers:edit'
  | 'customers:delete'
  // موردون
  | 'suppliers:create'
  | 'suppliers:edit'
  | 'suppliers:delete'
  // مصروفات
  | 'expenses:create'
  | 'expenses:edit'
  | 'expenses:delete'
  // هوالك
  | 'damages:create'
  | 'damages:edit'
  | 'damages:delete'
  // مرتجعات
  | 'returns:create'
  | 'returns:edit'
  | 'returns:delete'
  // عمال
  | 'workers:create'
  | 'workers:edit'
  | 'workers:delete'
  | 'workers:pay'
  | 'workers:advance'
  // مخازن
  | 'warehouses:create'
  | 'warehouses:edit'
  | 'warehouses:delete'
  // معارض
  | 'showrooms:create'
  | 'showrooms:edit'
  | 'showrooms:delete'
  // تسوية
  | 'settlement:execute'
  // إعدادات
  | 'settings:manage'
  // تقارير
  | 'reports:view'
  | 'reports:export'
  // تنبيهات
  | 'alerts:manage';

// ── مصفوفة الصلاحيات: Action → الأدوار المسموح لها ──
const ACTION_PERMISSIONS: Record<Action, Role[]> = {
  // ─ مبيعات ─
  'sales:create':    ['admin', 'warehouse_manager', 'worker'],
  'sales:edit':      ['admin', 'warehouse_manager'],
  'sales:delete':    ['admin', 'warehouse_manager'],
  'sales:payment':   ['admin', 'warehouse_manager'],
  'sales:print':     ['admin', 'warehouse_manager', 'worker', 'boss'],

  // ─ مشتريات ─
  'purchases:create': ['admin', 'warehouse_manager', 'worker'],
  'purchases:edit':   ['admin', 'warehouse_manager'],
  'purchases:delete': ['admin', 'warehouse_manager'],
  'purchases:payment':['admin', 'warehouse_manager'],

  // ─ منتجات ─
  'products:create': ['admin', 'warehouse_manager'],
  'products:edit':   ['admin', 'warehouse_manager'],
  'products:delete': ['admin'],

  // ─ مخزون ─
  'inventory:adjust':   ['admin', 'warehouse_manager'],
  'inventory:transfer': ['admin', 'warehouse_manager', 'driver'],

  // ─ عملاء ─
  'customers:create': ['admin', 'warehouse_manager'],
  'customers:edit':   ['admin', 'warehouse_manager'],
  'customers:delete': ['admin'],

  // ─ موردون ─
  'suppliers:create': ['admin', 'warehouse_manager'],
  'suppliers:edit':   ['admin', 'warehouse_manager'],
  'suppliers:delete': ['admin'],

  // ─ مصروفات ─
  'expenses:create': ['admin', 'warehouse_manager', 'worker'],
  'expenses:edit':   ['admin', 'warehouse_manager'],
  'expenses:delete': ['admin', 'warehouse_manager'],

  // ─ هوالك ─
  'damages:create': ['admin', 'warehouse_manager'],
  'damages:edit':   ['admin', 'warehouse_manager'],
  'damages:delete': ['admin'],

  // ─ مرتجعات ─
  'returns:create': ['admin', 'warehouse_manager'],
  'returns:edit':   ['admin', 'warehouse_manager'],
  'returns:delete': ['admin'],

  // ─ عمال ─
  'workers:create':  ['admin', 'warehouse_manager'],
  'workers:edit':    ['admin', 'warehouse_manager'],
  'workers:delete':  ['admin'],
  'workers:pay':     ['admin', 'warehouse_manager'],
  'workers:advance': ['admin', 'warehouse_manager'],

  // ─ مخازن ─
  'warehouses:create': ['admin', 'warehouse_manager'],
  'warehouses:edit':   ['admin', 'warehouse_manager'],
  'warehouses:delete': ['admin'],

  // ─ معارض ─
  'showrooms:create': ['admin', 'warehouse_manager'],
  'showrooms:edit':   ['admin', 'warehouse_manager'],
  'showrooms:delete': ['admin'],

  // ─ تسوية ─
  'settlement:execute': ['admin', 'warehouse_manager'],

  // ─ إعدادات ─
  'settings:manage': ['admin'],

  // ─ تقارير ─
  'reports:view':   ['admin', 'warehouse_manager', 'boss'],
  'reports:export': ['admin', 'warehouse_manager', 'boss'],

  // ─ تنبيهات ─
  'alerts:manage': ['admin', 'warehouse_manager', 'boss'],
};

/**
 * التحقق من صلاحية إجراء معين لدور معين
 */
export const can = (role: string | undefined | null, action: Action): boolean => {
  if (!role) return false;
  const allowed = ACTION_PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role as Role);
};

/**
 * التحقق من أن الدور ضمن الأدوار المسموحة لصفحة معينة
 */
export const canAccessRoute = (role: string | undefined | null, path: string): boolean => {
  if (!role) return false;
  // تطبيع المسارات الديناميكية (مثل /customers/123 → /customers/:id)
  const normalized = path.replace(/\/[0-9a-f-]{8,}$/, '/:id');
  const allowed = ROUTE_PERMISSIONS[normalized] || ROUTE_PERMISSIONS[path];
  if (!allowed) return true; // غير معرّف → مسموح (fallback)
  return allowed.includes(role as Role);
};

/**
 * الرسالة المعروضة عند رفض الصلاحية
 */
export const ACCESS_DENIED_MESSAGE: Record<Action, string> = {
  'sales:create':    'عامل المبيعات فقط من يمكنه إضافة فاتورة',
  'sales:edit':      'تعديل الفواتير متاح للمديرين فقط',
  'sales:delete':    'حذف الفواتير متاح للمديرين فقط',
  'sales:payment':   'تسجيل الدفعات متاح للمديرين فقط',
  'sales:print':     '',
  'purchases:create': 'إضافة مشتريات متاحة للمديرين فقط',
  'purchases:edit':   'تعديل المشتريات متاح للمديرين فقط',
  'purchases:delete': 'حذف المشتريات متاح للمديرين فقط',
  'purchases:payment':'تسديد الموردين متاح للمديرين فقط',
  'products:create': 'إضافة المنتجات للمديرين فقط',
  'products:edit':   'تعديل المنتجات للمديرين فقط',
  'products:delete': 'حذف المنتجات لمدير النظام فقط',
  'inventory:adjust':   'تعديل المخزون للمديرين فقط',
  'inventory:transfer': 'نقل المخزون للمديرين والسائقين فقط',
  'customers:create': 'إضافة العملاء للمديرين فقط',
  'customers:edit':   'تعديل العملاء للمديرين فقط',
  'customers:delete': 'حذف العملاء لمدير النظام فقط',
  'suppliers:create': 'إضافة الموردين للمديرين فقط',
  'suppliers:edit':   'تعديل الموردين للمديرين فقط',
  'suppliers:delete': 'حذف الموردين لمدير النظام فقط',
  'expenses:create': '',
  'expenses:edit':   'تعديل المصروفات للمديرين فقط',
  'expenses:delete': 'حذف المصروفات للمديرين فقط',
  'damages:create': 'تسجيل الهوالك للمديرين فقط',
  'damages:edit':   'تعديل الهوالك للمديرين فقط',
  'damages:delete': 'حذف الهوالك لمدير النظام فقط',
  'returns:create': 'تسجيل المرتجعات للمديرين فقط',
  'returns:edit':   'تعديل المرتجعات للمديرين فقط',
  'returns:delete': 'حذف المرتجعات للمديرين فقط',
  'workers:create':  'إضافة العمال للمديرين فقط',
  'workers:edit':    'تعديل العمال للمديرين فقط',
  'workers:delete':  'حذف العمال لمدير النظام فقط',
  'workers:pay':     'تسجيل مرتبات للمديرين فقط',
  'workers:advance': 'تسجيل سلف للمديرين فقط',
  'warehouses:create': 'إضافة المخازن للمديرين فقط',
  'warehouses:edit':   'تعديل المخازن للمديرين فقط',
  'warehouses:delete': 'حذف المخازن لمدير النظام فقط',
  'showrooms:create': 'إضافة المعارض للمديرين فقط',
  'showrooms:edit':   'تعديل المعارض للمديرين فقط',
  'showrooms:delete': 'حذف المعارض لمدير النظام فقط',
  'settlement:execute': 'تسوية المبيعات للمديرين فقط',
  'settings:manage': 'الإعدادات لمدير النظام فقط',
  'reports:view':    'التقارير للمديرين والرئيس فقط',
  'reports:export':  'تصدير التقارير للمديرين فقط',
  'alerts:manage':   'التنبيهات للمديرين فقط',
};

/**
 * Hook مساعد لبناء قائمة بمعلومات الدور الحالي
 */
export const ROLE_INFO: Record<Role, { label: string; color: string; bg: string; description: string }> = {
  admin: {
    label: 'مدير النظام',
    color: '#dc2626',
    bg: '#fef2f2',
    description: 'صلاحيات كاملة — يمكنه فعل أي شيء في النظام',
  },
  warehouse_manager: {
    label: 'مدير مخزن',
    color: '#1d4ed8',
    bg: '#eff6ff',
    description: 'إدارة كاملة للعمليات — بدون حذف الأنظمة الحرجة',
  },
  boss: {
    label: 'الرئيس (مشاهدة)',
    color: '#7c3aed',
    bg: '#fdf4ff',
    description: 'مشاهدة التقارير والبيانات فقط — لا تعديل ولا حذف',
  },
  driver: {
    label: 'سائق',
    color: '#059669',
    bg: '#f0fdf4',
    description: 'لوحة التحكم والتحويلات بين المخازن فقط',
  },
  worker: {
    label: 'عامل',
    color: '#d97706',
    bg: '#fffbeb',
    description: 'إضافة مبيعات ومشتريات ومصروفات فقط — بدون تعديل أو حذف',
  },
};
