import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Warehouse, Phone, Lock, Eye, EyeOff, Users, Building2, Music, VolumeX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useInteraction } from '@/hooks/useInteraction';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ── Soft ambient music using Web Audio API ── */
function createAmbientMusic(ctx: AudioContext): () => void {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 2.5);
  master.connect(ctx.destination);

  const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
  const timers: ReturnType<typeof setTimeout>[] = [];

  const playNote = (freq: number, startTime: number, dur: number, vol = 0.3) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
    osc.connect(gain); gain.connect(master);
    osc.start(startTime); osc.stop(startTime + dur + 0.1);
  };

  const patterns = [
    [0, 2, 4, 2, 1, 3, 5, 3],
    [2, 4, 5, 4, 2, 0, 1, 2],
    [0, 1, 2, 4, 3, 2, 1, 0],
  ];

  let loop = 0;
  const playLoop = () => {
    const pat = patterns[loop % patterns.length];
    const now = ctx.currentTime;
    pat.forEach((ni, i) => { playNote(notes[ni], now + i * 0.55, 0.9, 0.22 + Math.random() * 0.08); });
    if (loop % 2 === 0) playNote(notes[0] / 2, now, 4.5, 0.14);
    if (loop % 3 === 0) playNote(notes[2] / 2, now + 2.2, 4.5, 0.10);
    loop++;
    const t = setTimeout(playLoop, 4600);
    timers.push(t);
  };

  playLoop();
  return () => {
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    timers.forEach(clearTimeout);
  };
}

const phoneToEmail = (phone: string) => {
  const clean = phone.replace(/\D/g, '');
  return `${clean}@wms.local`;
};

/**
 * البرنامج ده مقفول على مستخدم واحد بس (صاحب العمل).
 * أي حساب تاني، حتى لو اتعمل من برا الواجهة (مثلاً عن طريق نداء API مباشر
 * بالـ anon key)، هيتم رفضه هنا وتسجيل خروجه فورًا بعد أي محاولة دخول ناجحة.
 * ملحوظة: القفل الحقيقي والموثوق لازم يكون من لوحة تحكم Supabase بتعطيل
 * "Allow new user signups"، الصفحة دي مجرد طبقة حماية إضافية في الواجهة.
 */
const ALLOWED_PHONE = '01101629931';
const ALLOWED_EMAIL = phoneToEmail(ALLOWED_PHONE);

const Login = () => {
  const { interact } = useInteraction();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const toggleMusic = () => {
    if (musicOn) {
      stopMusicRef.current?.();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      stopMusicRef.current = null;
      setMusicOn(false);
    } else {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      stopMusicRef.current = createAmbientMusic(ctx);
      setMusicOn(true);
    }
  };

  useEffect(() => {
    return () => {
      stopMusicRef.current?.();
      audioCtxRef.current?.close();
    };
  }, []);

  const handleLogin = async () => {
    if (!phone || !password) {
      interact('error');
      toast.error('يرجى إدخال رقم الهاتف وكلمة المرور');
      return;
    }
    setLoading(true);
    const email = phoneToEmail(phone);

    if (email !== ALLOWED_EMAIL) {
      interact('error');
      toast.error('رقم الهاتف أو كلمة المرور غير صحيحة');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      interact('error');
      toast.error('رقم الهاتف أو كلمة المرور غير صحيحة');
      setLoading(false);
      return;
    }

    // طبقة حماية إضافية: حتى لو نجح تسجيل الدخول، لازم يكون الإيميل
    // المرتبط بالحساب هو نفسه المسموح به بالظبط.
    if (data.user?.email !== ALLOWED_EMAIL) {
      await supabase.auth.signOut();
      interact('error');
      toast.error('هذا الحساب غير مصرّح له باستخدام البرنامج');
      setLoading(false);
      return;
    }

    interact('success');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-blue-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-violet-500/6 rounded-full blur-3xl" />
        {musicOn && (
          <>
            <div className="absolute top-1/3 left-1/3 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/3 right-1/3 w-48 h-48 bg-cyan-400/8 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
          </>
        )}
      </div>

      {/* Music toggle */}
      <button
        onClick={toggleMusic}
        title={musicOn ? 'إيقاف الموسيقى' : 'تشغيل الموسيقى'}
        className={cn(
          'fixed top-4 left-4 z-50 w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-lg',
          musicOn
            ? 'bg-gold-600 text-white shadow-gold-500/30'
            : 'bg-white/80 backdrop-blur text-slate-500 border border-slate-200 hover:border-gold-400 hover:text-gold-600'
        )}>
        {musicOn
          ? <Music className="w-5 h-5 animate-pulse" />
          : <VolumeX className="w-5 h-5" />}
      </button>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-up">
          <div className="w-16 h-16 gradient-blue glow-blue rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Warehouse className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">نظام إدارة المخازن</h1>
          <p className="text-sm text-muted-foreground mt-1">الموزعة للأسواق والمنافذ التجارية</p>
        </div>

        {/* Login Type Selector */}
        <div className="grid grid-cols-2 gap-3 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <Link to="/login"
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-primary bg-primary/8 text-center transition-all">
            <div className="w-10 h-10 gradient-blue rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">صاحب العمل</p>
              <p className="text-xs text-muted-foreground">مدير / مالك</p>
            </div>
          </Link>
          <Link to="/employee-login"
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-border bg-card text-center transition-all hover:border-emerald-500/40 hover:bg-emerald-500/5">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">موظف</p>
              <p className="text-xs text-muted-foreground">عامل / سائق</p>
            </div>
          </Link>
        </div>

        <div className="glass rounded-2xl border border-border p-6 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="mb-5">
            <p className="text-sm font-semibold text-foreground">تسجيل دخول صاحب العمل</p>
            <p className="text-xs text-muted-foreground mt-1">أدخل رقم هاتفك وكلمة المرور</p>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">رقم الهاتف</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="tel" value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">كلمة المرور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-card border border-border rounded-xl py-2.5 pr-10 pl-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                <button type="button"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button disabled={loading}
              className="w-full gradient-blue glow-blue text-white rounded-xl py-3 font-bold text-sm active:scale-95 disabled:opacity-60 transition-all"
              onClick={handleLogin}>
              {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          نظام إدارة المخازن الموزعة © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
};

export default Login;
