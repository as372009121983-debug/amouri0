import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const phoneToEmail = (phone: string) => {
  const clean = phone.replace(/\D/g, '');
  return `${clean}@wms.local`;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callerUser }, error: callerErr } = await supabaseAdmin.auth.getUser(token);

    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('role, owner_id, id')
      .eq('id', callerUser.id)
      .single();

    const callerRole = callerProfile?.role;
    if (callerRole !== 'admin' && callerRole !== 'warehouse_manager') {
      return new Response(JSON.stringify({ error: 'غير مصرح لك بإنشاء حسابات' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The owner_id for the new worker: admin's own id if they are the root owner,
    // otherwise use the caller's owner_id
    const ownerId = callerProfile?.owner_id ?? callerUser.id;

    const body = await req.json();
    // ── Change password mode (admin resets a worker they own) ────────────
    if (body.action === 'change_password') {
      const { workerId, newPassword } = body;
      if (!workerId || !newPassword) {
        return new Response(JSON.stringify({ error: 'workerId و newPassword مطلوبان' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (callerRole !== 'admin') {
        return new Response(JSON.stringify({ error: 'فقط المدير يمكنه تغيير كلمة المرور' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(workerId, { password: newPassword });
      if (pwdErr) {
        return new Response(JSON.stringify({ error: pwdErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, message: 'تم تغيير كلمة المرور بنجاح' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Super-owner mode: reset the password for ANY phone number in the
    // whole system, regardless of who owns that account. Restricted to the
    // single hard-coded owner account, same check used to show the "إدارة
    // المستخدمين" page in the sidebar. ─────────────────────────────────────
    if (body.action === 'super_reset_password') {
      const SUPER_OWNER_EMAIL = '01278764440@wms.local';
      if (callerUser.email !== SUPER_OWNER_EMAIL) {
        return new Response(JSON.stringify({ error: 'غير مصرح لك بهذا الإجراء' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { phone, newPassword } = body;
      if (!phone || !newPassword) {
        return new Response(JSON.stringify({ error: 'رقم الهاتف وكلمة المرور الجديدة مطلوبان' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const cleanPhone = phone.replace(/\D/g, '');
      const targetEmail = phoneToEmail(cleanPhone);

      const { data: targetProfile, error: findErr } = await supabaseAdmin
        .from('user_profiles')
        .select('id, full_name, phone, email')
        .or(`phone.eq.${cleanPhone},email.eq.${targetEmail}`)
        .maybeSingle();

      if (findErr || !targetProfile) {
        return new Response(JSON.stringify({ error: 'لا يوجد حساب بهذا الرقم' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(targetProfile.id, { password: newPassword });
      if (pwdErr) {
        return new Response(JSON.stringify({ error: pwdErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        message: `تم تغيير كلمة المرور لـ ${targetProfile.full_name || cleanPhone} بنجاح`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { phone, full_name, role, max_salary, password } = body;

    if (!phone || !full_name) {
      return new Response(JSON.stringify({ error: 'رقم الهاتف والاسم مطلوبان' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: 'كلمة المرور مطلوبة (6 أحرف على الأقل)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const workerPassword = password;
    const email = phoneToEmail(phone);
    const cleanPhone = phone.replace(/\D/g, '');

    console.log(`Creating worker: phone=${phone}, email=${email}, role=${role}, owner_id=${ownerId}`);

    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return new Response(JSON.stringify({ error: 'رقم الهاتف مسجل مسبقاً' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: signUpData, error: signUpErr } = await supabaseAnon.auth.signUp({
      email,
      password: workerPassword,
      options: {
        data: {
          full_name,
          phone: cleanPhone,
          role: role || 'worker',
        },
      },
    });

    if (signUpErr) {
      console.error('SignUp error:', signUpErr.message);
      return new Response(JSON.stringify({ error: signUpErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!signUpData.user) {
      return new Response(JSON.stringify({ error: 'فشل إنشاء الحساب' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = signUpData.user.id;

    await supabaseAdmin.rpc('confirm_user_email' as never, { user_id: userId });

    const { error: profileErr } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: userId,
        email,
        username: cleanPhone,
        full_name,
        phone: cleanPhone,
        role: role || 'worker',
        max_salary: max_salary || 0,
        active: true,
        owner_id: ownerId,
      }, { onConflict: 'id' });

    if (profileErr) {
      console.error('Profile upsert error:', profileErr.message);
    }

    console.log(`Worker created: userId=${userId}, owner_id=${ownerId}`);

    return new Response(JSON.stringify({
      success: true,
      userId,
      message: 'تم إنشاء الحساب بنجاح',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unexpected error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
