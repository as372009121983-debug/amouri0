import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { context } = await req.json();

    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!apiKey || !baseUrl) throw new Error('AI configuration missing');

    // Get live product & sales data for specific recommendations
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get auth header to filter by owner
    const authHeader = req.headers.get('Authorization');
    let ownerFilter: string | null = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: rpc } = await supabase.rpc('get_owner_id' as never, { uid: user.id });
        ownerFilter = rpc as string | null;
      }
    }

    // Fetch top selling products
    let saleItemsQ = supabase.from('sale_items').select('product_name, product_id, quantity, unit_price');
    const { data: saleItems } = await saleItemsQ;

    // Aggregate by product
    const productSales: Record<string, { name: string; qty: number; revenue: number }> = {};
    (saleItems || []).forEach((it: any) => {
      const key = it.product_id || it.product_name;
      if (!productSales[key]) productSales[key] = { name: it.product_name, qty: 0, revenue: 0 };
      productSales[key].qty += it.quantity;
      productSales[key].revenue += it.quantity * it.unit_price;
    });
    const topSelling = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const slowMoving = Object.values(productSales).sort((a, b) => a.qty - b.qty).slice(0, 3);

    // Fetch inventory shortages
    const { data: invData } = await supabase.from('inventory').select('quantity, products(name, min_stock, purchase_price, price)');
    const shortages = (invData || []).filter((r: any) => (r.quantity || 0) < (r.products?.min_stock || 0));
    const outOfStock = (invData || []).filter((r: any) => r.quantity === 0);

    // Fetch customer debts
    let custQ = supabase.from('customers').select('name, balance').gt('balance', 0).order('balance', { ascending: false }).limit(5);
    if (ownerFilter) custQ = custQ.eq('owner_id', ownerFilter);
    const { data: debtors } = await custQ;

    const productData = `
أكثر المنتجات مبيعاً:
${topSelling.map(p => `- ${p.name}: ${p.qty} وحدة | إيراد: ${p.revenue.toLocaleString()} ج.م`).join('\n') || 'لا بيانات'}

المنتجات الأبطأ حركة:
${slowMoving.map(p => `- ${p.name}: ${p.qty} وحدة فقط`).join('\n') || 'لا بيانات'}

المنتجات النافدة: ${outOfStock.length} صنف
${outOfStock.slice(0, 3).map((r: any) => `- ${r.products?.name || '—'}`).join('\n')}

المنتجات أقل من حد التنبيه: ${shortages.length} صنف
${shortages.slice(0, 3).map((r: any) => `- ${r.products?.name}: متاح ${r.quantity} | حد التنبيه ${r.products?.min_stock}`).join('\n')}

أكبر ديون العملاء:
${(debtors || []).map((c: any) => `- ${c.name}: ${Number(c.balance).toLocaleString()} ج.م`).join('\n') || 'لا ديون'}`;

    const prompt = `أنت مستشار أعمال خبير في إدارة المخازن والتجارة المصرية. بناءً على البيانات التالية:

${context}

${productData}

أعطني بالضبط 3 نصائح عملية ومحددة وقابلة للتطبيق الفوري لزيادة الأرباح.

القواعد:
- بالضبط 3 نصائح كل واحدة تبدأ بـ "•"
- اذكر أسماء منتجات محددة من البيانات (مثال: "ارفع سعر [اسم المنتج] إلى...")
- إذا هناك منتجات نافدة، اقترح طلب [اسم المنتج] من المورد
- إذا هناك ديون، اذكر أسماء العملاء وكيف تحصلها
- إذا هناك منتجات بطيئة، اقترح تخفيض سعرها أو عروض
- ركز على فرص ربحية فعلية من البيانات
- كل نصيحة لا تتجاوز سطرين
- اللغة العربية العامية المصرية المباشرة`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';

    let tips: string[] = text
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('•'))
      .map((l: string) => l.replace(/^•\s*/, '').trim())
      .filter((t: string) => t.length > 10)
      .slice(0, 3);

    if (tips.length < 1) {
      tips = text
        .split('\n')
        .map((l: string) => l.trim().replace(/^\d+[\.\-\)]\s*/, ''))
        .filter((l: string) => l.length > 20)
        .slice(0, 3);
    }

    return new Response(JSON.stringify({ tips }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('generate-tips error:', error);
    return new Response(
      JSON.stringify({ error: String(error), tips: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
