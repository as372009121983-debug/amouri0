import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ORDERED_DELETE = [
  'showroom_inventory', 'return_items', 'returns',
  'sale_items', 'sales', 'purchase_items', 'purchases',
  'transfer_items', 'transfers', 'worker_transactions',
  'customer_payments', 'supplier_payments',
  'expenses', 'damages', 'alerts', 'inventory',
  'showrooms', 'customers', 'suppliers', 'products', 'warehouses',
];

const ORDERED_INSERT = [
  'warehouses', 'products', 'customers', 'suppliers', 'showrooms',
  'inventory', 'showroom_inventory',
  'sales', 'sale_items', 'purchases', 'purchase_items',
  'transfers', 'transfer_items', 'returns', 'return_items',
  'expenses', 'damages', 'alerts',
  'customer_payments', 'supplier_payments', 'worker_transactions',
];

// Tables that have owner_id column — must be overwritten with current admin's id
const OWNER_ID_TABLES = new Set([
  'warehouses', 'products', 'customers', 'suppliers', 'showrooms',
  'sales', 'purchases', 'returns', 'expenses', 'damages', 'alerts',
]);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Verify caller role using their token
    const token = authHeader.replace('Bearer ', '');
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await callerClient
      .from('user_profiles')
      .select('role, owner_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Resolve the owner_id to stamp on all restored rows ──
    // Admins without an owner_id are their own owner
    const ownerIdToStamp: string = profile.owner_id ?? user.id;
    console.log('Restoring as owner_id:', ownerIdToStamp);

    // Parse backup — service role client bypasses RLS entirely
    const backup = await req.json() as Record<string, unknown>;

    if (!backup._version) {
      return new Response(JSON.stringify({ error: 'Invalid backup file — missing _version' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // ── 1. Delete existing owner's data in FK-safe order ──

    // ── 1. Delete existing owner's data in FK-safe order ──
    // Use admin client so we can delete by owner_id
    const deleteErrors: string[] = [];
    for (const table of ORDERED_DELETE) {
      let query: any;
      if (OWNER_ID_TABLES.has(table)) {
        // Only delete rows belonging to this owner
        query = admin.from(table as never).delete().eq('owner_id', ownerIdToStamp);
      } else {
        // Tables without owner_id — delete all (they are linked via FK to owner's rows)
        query = admin.from(table as never).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }
      const { error } = await query;
      if (error) {
        console.warn(`Delete warning [${table}]:`, error.message);
        deleteErrors.push(`${table}: ${error.message}`);
      }
    }

    // ── 2. Insert rows with field sanitization and owner_id stamping ──
    let restored = 0;
    let skipped  = 0;
    const insertErrors: string[] = [];

    // Known columns per table (strips unknown columns from old backups)
    const TABLE_COLUMNS: Record<string, string[]> = {
      warehouses: ['id','name','code','type','location','city','manager','capacity','used','status','phone','created_at','owner_id'],
      products: ['id','name','sku','barcode','category','unit','min_stock','price','created_at','min_sale_price','max_sale_price','purchase_price','owner_id'],
      customers: ['id','name','phone','location','notes','balance','created_at','owner_id'],
      suppliers: ['id','name','phone','location','notes','balance','created_at','owner_id'],
      showrooms: ['id','name','location','phone','notes','owner_id','created_at'],
      inventory: ['id','product_id','warehouse_id','quantity','last_updated'],
      showroom_inventory: ['id','showroom_id','product_id','product_name','quantity','last_updated'],
      sales: ['id','customer_id','customer_name','warehouse_id','warehouse_name','total_amount','paid_amount','discount','status','notes','sale_date','created_at','owner_id'],
      sale_items: ['id','sale_id','product_id','product_name','quantity','unit_price','total_price','unit'],
      purchases: ['id','supplier_id','supplier_name','warehouse_id','warehouse_name','total_amount','paid_amount','status','notes','purchase_date','created_at','owner_id'],
      purchase_items: ['id','purchase_id','product_id','product_name','quantity','unit_price','total_price','unit'],
      transfers: ['id','from_warehouse_id','to_warehouse_id','from_warehouse_name','to_warehouse_name','status','driver_name','notes','total_items','created_at','updated_at'],
      transfer_items: ['id','transfer_id','product_id','product_name','quantity','unit'],
      returns: ['id','type','reference_id','customer_id','supplier_id','customer_name','supplier_name','total_amount','reason','status','return_date','created_at','owner_id'],
      return_items: ['id','return_id','product_id','product_name','quantity','unit_price','unit'],
      expenses: ['id','description','amount','category','expense_date','created_at','owner_id'],
      damages: ['id','product_name','warehouse_name','quantity','reason','damage_date','created_at','damage_type','unit','unit_cost','owner_id'],
      alerts: ['id','type','message','warehouse_id','warehouse_name','read','created_at','owner_id'],
      customer_payments: ['id','customer_id','customer_name','amount','type','notes','payment_date','created_at','payment_method','sale_id'],
      supplier_payments: ['id','supplier_id','supplier_name','amount','notes','payment_date','created_at'],
      worker_transactions: ['id','worker_id','worker_name','type','amount','notes','transaction_date','created_at'],
    };

    // ── Include new v3 fields for sales/purchases ──
    TABLE_COLUMNS.sales = ['id','customer_id','customer_name','warehouse_id','warehouse_name','total_amount','paid_amount','initial_paid_amount','discount','status','notes','sale_date','created_at','owner_id','invoice_type','manual_status','payment_method','wallet_from','wallet_to'];
    TABLE_COLUMNS.purchases = ['id','supplier_id','supplier_name','warehouse_id','warehouse_name','total_amount','paid_amount','status','notes','purchase_date','created_at','owner_id','payment_method','wallet_from','wallet_to'];

    const sanitizeRow = (
      table: string,
      row: Record<string, unknown>,
    ): Record<string, unknown> => {
      const allowed = TABLE_COLUMNS[table];
      if (!allowed) return row;
      const clean: Record<string, unknown> = {};
      for (const col of allowed) {
        if (col in row) clean[col] = row[col];
      }
      // ── KEY FIX: always overwrite owner_id with current admin's owner_id ──
      // This prevents FK violations when restoring to a different account/DB
      if (OWNER_ID_TABLES.has(table)) {
        clean['owner_id'] = ownerIdToStamp;
      }
      return clean;
    };

    for (const table of ORDERED_INSERT) {
      const rows = backup[table] as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      // Chunk 50 rows at a time
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = (rows.slice(i, i + 50) as Record<string, unknown>[]).map(r => sanitizeRow(table, r));
        const { error } = await admin.from(table as never).insert(chunk as never);
        if (error) {
          console.error(`Insert error [${table}] chunk ${i}:`, error.message);
          insertErrors.push(`${table}[${i}]: ${error.message}`);
          skipped += chunk.length;
        } else {
          restored += chunk.length;
        }
      }
    }

    // ── تحديث بيانات المستخدمين (للنسخة v3) ──
    if (backup['user_profiles_meta']) {
      const profileRows = backup['user_profiles_meta'] as Record<string, unknown>[];
      const allowedProfileCols = ['id','username','email','role','full_name','phone','active','max_salary','hire_date'];
      for (const row of profileRows) {
        const clean: Record<string, unknown> = {};
        for (const col of allowedProfileCols) {
          if (col in row) clean[col] = row[col];
        }
        // تحديث الحقول فقط (DO NOT overwrite id/email to avoid auth conflicts)
        const { error: pe } = await admin.from('user_profiles').upsert(clean as never, { onConflict: 'id' });
        if (pe) console.warn('user_profiles upsert warning:', pe.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        restored,
        skipped,
        deleteErrors,
        insertErrors,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('restore-backup fatal error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
