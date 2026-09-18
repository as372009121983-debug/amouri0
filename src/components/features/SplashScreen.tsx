import { useEffect, useState } from 'react';
import logoImg from '@/assets/logo.png';

interface SplashScreenProps { onDone: () => void; }

const SplashScreen = ({ onDone }: SplashScreenProps) => {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');

  useEffect(() => {
    const playAmbientMusic = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const master = ctx.createGain();
        master.gain.setValueAtTime(0, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.6);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 4.2);
        master.connect(ctx.destination);

        const playNote = (freq: number, start: number, dur: number, vol = 0.28) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0, ctx.currentTime + start);
          gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
          osc.connect(gain);
          gain.connect(master);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur + 0.1);
        };

        // Gentle rising melody — صعود لحني هادئ
        const melody = [
          [261.63, 0.0, 0.55],
          [329.63, 0.45, 0.55],
          [392.00, 0.90, 0.55],
          [523.25, 1.35, 0.70],
          [659.25, 2.00, 0.70],
          [783.99, 2.65, 0.90],
          [1046.5, 3.35, 1.10],
        ];
        melody.forEach(([f, s, d]) => playNote(f, s, d, 0.22));

        // Soft harmonic chords underneath
        [[261.63, 0.0], [329.63, 1.2], [392.00, 2.5]].forEach(([f, s]) =>
          playNote(f / 2, s, 1.4, 0.09)
        );

        // Final warm chord
        [523.25, 659.25, 783.99].forEach((f, i) =>
          playNote(f, 3.3 + i * 0.04, 1.2, 0.12)
        );

        setTimeout(() => ctx.close(), 5500);
      } catch { /* silent */ }
    };

    const t0 = setTimeout(playAmbientMusic, 120);
    const t1 = setTimeout(() => setPhase('visible'), 80);
    const t2 = setTimeout(() => setPhase('exit'), 3800);
    const t3 = setTimeout(() => onDone(), 4250);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'linear-gradient(160deg,#0a0e1a 0%,#a97a1f 55%,#0a0e1a 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        direction: 'rtl',
        opacity: phase === 'exit' ? 0 : 1,
        transition: phase === 'exit' ? 'opacity 0.45s ease-out' : 'none',
      }}
    >
      {/* Background decorative circles */}
      <div style={{
        position: 'absolute', top: '-80px', right: '-80px',
        width: '320px', height: '320px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-60px', left: '-60px',
        width: '240px', height: '240px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.03)', pointerEvents: 'none',
      }} />

      {/* Logo container */}
      <div style={{
        transform: phase === 'enter' ? 'scale(0.6) translateY(30px)' : 'scale(1) translateY(0)',
        opacity: phase === 'enter' ? 0 : 1,
        transition: 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1), opacity 0.5s ease',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px',
      }}>
        {/* Logo card */}
        <div style={{
          width: '120px', height: '120px', borderRadius: '28px',
          background: 'rgba(255,255,255,0.96)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35), 0 0 0 1.5px rgba(255,255,255,0.15)',
          padding: '14px',
        }}>
          <img src={logoImg} alt="العموري" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>

        {/* Company name */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontFamily: "'Cairo',sans-serif", fontWeight: 900,
            fontSize: '28px', color: '#ffffff', margin: 0, lineHeight: 1.2,
            letterSpacing: '-0.5px',
          }}>العموري</h1>
          <p style={{
            fontFamily: "'Cairo',sans-serif", fontWeight: 500,
            fontSize: '13px', color: 'rgba(255,255,255,0.65)',
            margin: '6px 0 0', letterSpacing: '0.5px',
          }}>لقطع غيار السيارات بالدلنجات</p>
          <p style={{
            fontFamily: "'Cairo',sans-serif", fontWeight: 400,
            fontSize: '11px', color: 'rgba(255,255,255,0.4)',
            margin: '3px 0 0',
          }}>نظام إدارة المخازن المتكامل</p>
        </div>

        {/* Loading dots */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '7px', height: '7px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.5)',
              animation: `dot-pulse 1.2s ease-in-out ${i * 0.18}s infinite`,
            }} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes dot-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
