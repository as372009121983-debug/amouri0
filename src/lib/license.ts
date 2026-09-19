/**
 * وحدة التحقق من الترخيص
 * ----------------------------------------------------------------
 * البرنامج ده مرخّص حصريًا للمشروع التالي، وربط ثابت جوه الكود
 * (مش مجرد متغير بيئة قابل للتغيير من .env).
 *
 * لو حد نسخ ملفات البرنامج وشغّلها على قاعدة بيانات Supabase تانية،
 * أو عطّل/غيّر صف الترخيص في القاعدة الأصلية، البرنامج هيوقف ويعرض
 * شاشة "غير مرخّص" بدل الدخول على البيانات.
 *
 * ملحوظة: ده قيد رادع للاستخدام العادي، مش تشفير غير قابل للكسر —
 * أي مطوّر يفتح هذا الملف ويشيله. الحماية الحقيقية القانونية بتيجي
 * من عقد/اتفاق الترخيص المكتوب مع المشتري.
 */
import { createClient } from '@supabase/supabase-js';

/** رابط مشروع Supabase المرخّص له فقط — ثابت، لا يُقرأ من .env */
export const LICENSED_SUPABASE_URL = 'https://fvxmzagzrdoxwqcsyeag.supabase.co';

/** مفتاح الترخيص الثابت لهذه النسخة */
export const LICENSE_KEY = 'ELM-3DC8-AF8B-D32D-5AC3';

export type LicenseStatus = 'checking' | 'valid' | 'invalid_project' | 'invalid_key' | 'error';

/**
 * يتحقق من:
 * 1) إن رابط Supabase الحالي (من .env وقت البناء) يطابق الرابط المرخّص له.
 * 2) إن جدول app_license في نفس القاعدة فيه صف بنفس المفتاح وحالته active.
 */
export async function verifyLicense(): Promise<LicenseStatus> {
  const currentUrl = (import.meta.env.VITE_SUPABASE_URL as string || '').replace(/\/+$/, '');
  const expectedUrl = LICENSED_SUPABASE_URL.replace(/\/+$/, '');

  if (currentUrl !== expectedUrl) {
    return 'invalid_project';
  }

  try {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const client = createClient(currentUrl, anonKey);
    const { data, error } = await client
      .from('app_license')
      .select('active')
      .eq('license_key', LICENSE_KEY)
      .maybeSingle();

    if (error) return 'error';
    if (!data || data.active !== true) return 'invalid_key';
    return 'valid';
  } catch {
    return 'error';
  }
}
