import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** دالة تنسيق آمنة — تمنع خطأ null.toLocaleString */
export const safeNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

export const EGP = (v: unknown): string => {
  const n = safeNum(v);
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2 }) + ' ج.م';
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'wms-auth-token',
    storage: window.localStorage,
  },
});

/**
 * Supabase/PostgREST بترجع 1000 صف بحد أقصى لكل طلب افتراضيًا.
 * الدالة دي بتجيب كل الصفوف على دفعات (pagination) عشان الجداول اللي ممكن
 * تعدي 1000 صف (زي المنتجات) متتقصش في أي مكان في البرنامج.
 */
export async function fetchAllRows<T = any>(
  table: string,
  columns: string,
  orderBy?: { column: string; ascending?: boolean },
  filter?: (q: any) => any,
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  let all: T[] = [];
  while (true) {
    let q = supabase.from(table as never).select(columns) as any;
    if (filter) q = filter(q);
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat((data || []) as T[]);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export type UserRole = 'admin' | 'warehouse_manager' | 'driver' | 'worker' | 'boss';

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  active: boolean;
  owner_id: string | null;
  max_salary?: number;
  hire_date?: string;
}
