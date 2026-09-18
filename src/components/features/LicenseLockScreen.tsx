import type { LicenseStatus } from '@/lib/license';

const messages: Record<string, { title: string; body: string }> = {
  invalid_project: {
    title: 'هذه النسخة غير مرخّصة لهذا الجهاز',
    body: 'تم ربط هذا البرنامج بقاعدة بيانات غير معتمدة. تواصل مع الجهة التي زوّدتك بالبرنامج.',
  },
  invalid_key: {
    title: 'الترخيص غير فعّال',
    body: 'تم إيقاف تفعيل هذه النسخة. تواصل مع الجهة التي زوّدتك بالبرنامج لمعرفة السبب.',
  },
  error: {
    title: 'تعذّر التحقق من الترخيص',
    body: 'تأكد من اتصالك بالإنترنت وأعد المحاولة. إذا استمرت المشكلة تواصل مع الدعم الفني.',
  },
};

const LicenseLockScreen = ({ status }: { status: Exclude<LicenseStatus, 'checking' | 'valid'> }) => {
  const msg = messages[status] || messages.error;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'linear-gradient(160deg,#1a1a1a 0%,#2a2a2a 55%,#1a1a1a 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      direction: 'rtl', padding: '24px', textAlign: 'center',
    }}>
      <div style={{
        width: '76px', height: '76px', borderRadius: '50%',
        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px',
        fontSize: '34px',
      }}>🔒</div>
      <h1 style={{
        fontFamily: "'Cairo',sans-serif", fontWeight: 800, fontSize: '20px',
        color: '#fff', margin: 0,
      }}>{msg.title}</h1>
      <p style={{
        fontFamily: "'Cairo',sans-serif", fontWeight: 400, fontSize: '13px',
        color: 'rgba(255,255,255,0.6)', marginTop: '10px', maxWidth: '360px', lineHeight: 1.7,
      }}>{msg.body}</p>
    </div>
  );
};

export default LicenseLockScreen;
