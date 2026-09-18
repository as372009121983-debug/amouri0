import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { messages, system, model, includeData } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase    = createClient(supabaseUrl, serviceKey);

    // ── Caller identity ────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    let ownerFilter: string | null = null;
    let callerRole: string | null = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: rpc } = await supabase.rpc('get_owner_id' as never, { uid: user.id });
        ownerFilter = rpc as string | null;
        const { data: profile } = await supabase
          .from('user_profiles').select('role').eq('id', user.id).single();
        if (profile) callerRole = profile.role;
      }
    }

    // ── Live Data (optional) ───────────────────────────────────────────────
    let contextData = '';
    if (includeData) {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

        let salesQ = supabase.from('sales')
          .select('total_amount,paid_amount,sale_date,sale_items(product_name,quantity)')
          .gte('sale_date', dateStr).limit(50);
        if (ownerFilter) salesQ = salesQ.eq('owner_id', ownerFilter);

        let purchQ = supabase.from('purchases')
          .select('total_amount,purchase_date').gte('purchase_date', dateStr).limit(30);
        if (ownerFilter) purchQ = purchQ.eq('owner_id', ownerFilter);

        let custQ = supabase.from('customers')
          .select('name,balance').gt('balance', 0)
          .order('balance', { ascending: false }).limit(10);
        if (ownerFilter) custQ = custQ.eq('owner_id', ownerFilter);

        let expQ = supabase.from('expenses')
          .select('amount').gte('expense_date', dateStr).limit(50);
        if (ownerFilter) expQ = expQ.eq('owner_id', ownerFilter);

        const [{ data: sales }, { data: purchases }, { data: customers }, { data: expenses }] =
          await Promise.all([salesQ, purchQ, custQ, expQ]);

        const salesTotal = (sales || []).reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0);
        const salesPaid  = (sales || []).reduce((s: number, x: any) => s + Number(x.paid_amount || 0), 0);
        const purchTotal = (purchases || []).reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0);
        const expTotal   = (expenses || []).reduce((s: number, x: any) => s + Number(x.amount || 0), 0);

        contextData = `\n\nبيانات حية (30 يوم): مبيعات=${salesTotal.toLocaleString()} ج.م | محصّل=${salesPaid.toLocaleString()} | مشتريات=${purchTotal.toLocaleString()} | مصروفات=${expTotal.toLocaleString()} | صافي ربح=${(salesTotal-purchTotal-expTotal).toLocaleString()}\nمديونيات عملاء: ${(customers||[]).map((c:any)=>`${c.name}: ${c.balance}`).join(', ')||'لا يوجد'}`;
      } catch (e) {
        console.error('live data error:', e);
      }
    }

    // ── System prompt ──────────────────────────────────────────────────────
    const defaultSystem = `أنت مساعد ذكي محترف لشركة العموري لقطع غيار السيارات بالدلنجات. دورك: ${callerRole || 'موظف'}.
أجب بالعربية دائماً. كن دقيقاً ومختصراً ومفيداً في مجالات التجارة والمخازن والمحاسبة وأي موضوع آخر.${contextData}`;

    const systemContent = system || defaultSystem;

    // ── Call OnSpace AI ────────────────────────────────────────────────────
    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemContent },
          ...(messages || []).slice(-12),
        ],
        max_tokens: 1500,
      }),
    });

    const responseText = await aiResponse.text();
    if (!aiResponse.ok) {
      return new Response(
        JSON.stringify({ error: `AI error [${aiResponse.status}]: ${responseText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content ?? 'عذراً، لم أتمكن من الإجابة.';

    return new Response(
      JSON.stringify({ content, choices: data.choices }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('ai-chat error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
