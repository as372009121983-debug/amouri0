-- =====================================================================
-- تصحيح: عمود حد الائتمان (max_debt_limit) ناقص من جدول customers
-- شغّل السطر ده مرة واحدة بس في: Supabase Dashboard → SQL Editor → New query
-- (آمن تمامًا، مش هيمسح أو يغيّر أي بيانات موجودة)
-- =====================================================================

alter table public.customers
  add column if not exists max_debt_limit numeric default 0;
