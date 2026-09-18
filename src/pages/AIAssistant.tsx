import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Mic, MicOff, Volume2, VolumeX, Bot, User, Trash2, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useInteraction } from '@/hooks/useInteraction';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const SYSTEM_PROMPT = `أنت مساعد ذكي متخصص لشركة العموري لقطع غيار السيارات بالدلنجات. تتحدث العربية بطلاقة وأسلوب احترافي.

خبراتك تشمل:
- التجارة والمخازن وإدارة المخزون
- المبيعات والمشتريات والفواتير
- محاسبة الموردين والعملاء
- الأرباح وهوامش الربح
- إدارة العمال والمرتبات
- تحليل البيانات المالية
- نصائح تجارية وتسويقية
- إجابة أي سؤال بشكل احترافي ودقيق

قواعد الإجابة:
- كن دقيقاً ومختصراً وعملياً
- استخدم الأرقام والأمثلة عند الحاجة
- إذا كان السؤال يتعلق بالنظام اشرح كيفية استخدامه
- أجب بالعربية دائماً ما لم يطلب غير ذلك`;

const AIAssistant = () => {
  const { interact } = useInteraction();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: 'مرحباً! أنا المساعد الذكي للإمري. يمكنني مساعدتك في كل ما يتعلق بالتجارة والمخازن والمبيعات والمحاسبة. اسألني أي شيء!',
      ts: Date.now(),
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    return () => { stopSpeaking(); };
  }, []);

  const stopSpeaking = () => {
    synthRef.current?.cancel();
    setSpeaking(false);
  };

  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !synthRef.current) return;
    stopSpeaking();
    const cleanText = text.replace(/[*_`#]/g, '').replace(/\n+/g, ' ');
    const utt = new SpeechSynthesisUtterance(cleanText);
    utt.lang = 'ar-EG';
    utt.rate = 1.0;
    utt.pitch = 1.0;
    const voices = synthRef.current.getVoices();
    const arabicVoice = voices.find(v => v.lang.startsWith('ar'));
    if (arabicVoice) utt.voice = arabicVoice;
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    synthRef.current.speak(utt);
  }, [ttsEnabled]);

  const startListening = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) { toast.error('المتصفح لا يدعم التعرف على الصوت'); return; }
    const rec = new SpeechRec();
    rec.lang = 'ar-EG';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput(prev => prev ? prev + ' ' + transcript : transcript);
      setListening(false);
    };
    rec.onerror = () => { setListening(false); toast.error('تعذر التعرف على الصوت'); };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput('');
    interact('click');

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content, ts: Date.now() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    const historyForAPI = updatedMessages.slice(-12).map(m => ({ role: m.role, content: m.content }));

    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: {
        messages: historyForAPI,
        system: SYSTEM_PROMPT,
        model: 'google/gemini-3-flash-preview',
      },
    });

    setLoading(false);

    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { msg = await error.context?.text() || msg; } catch { /* noop */ }
      }
      toast.error('خطأ: ' + msg);
      return;
    }

    const reply = data?.content || data?.choices?.[0]?.message?.content || 'عذراً، لم أفهم سؤالك.';
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: reply, ts: Date.now() };
    setMessages(prev => [...prev, assistantMsg]);
    speak(reply);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => {
    setMessages([{ id: '0', role: 'assistant', content: 'تم مسح المحادثة. كيف يمكنني مساعدتك؟', ts: Date.now() }]);
    stopSpeaking();
  };

  const SUGGESTIONS = [
    'كيف أحسب هامش الربح؟',
    'ما هي أفضل طرق إدارة المخزون؟',
    'كيف أتعامل مع العميل المتأخر في السداد؟',
    'نصائح لزيادة المبيعات',
    'كيف أحسب سعر البيع المناسب؟',
    'ما هي مؤشرات صحة التدفق النقدي؟',
  ];

  return (
    <div className="flex flex-col h-[calc(100dvh-80px)] max-h-[800px]">
      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden shadow-sm mb-3 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base">المساعد الذكي</p>
              <p className="text-white/60 text-xs">مدعوم بـ Gemini 3 Flash</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setTtsEnabled(!ttsEnabled); if (ttsEnabled) stopSpeaking(); }}
              title={ttsEnabled ? 'إيقاف الصوت' : 'تشغيل الصوت'}
              className={cn('w-9 h-9 rounded-xl flex items-center justify-center transition-all border',
                ttsEnabled ? 'bg-white text-gold-700 border-white' : 'bg-white/15 text-white border-white/20 hover:bg-white/25')}>
              {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button onClick={clearChat}
              className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 flex items-center justify-center text-white transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-2 scrollbar-thin">
        {messages.map(msg => (
          <div key={msg.id} className={cn('flex gap-2.5 animate-fade-up', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn('w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5',
              msg.role === 'user' ? 'bg-gold-600' : 'bg-slate-100')}>
              {msg.role === 'user'
                ? <User className="w-4 h-4 text-white" />
                : <Bot className="w-4 h-4 text-gold-600" />}
            </div>
            <div className={cn('max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              msg.role === 'user'
                ? 'bg-gold-600 text-white rounded-tr-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm')}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p className={cn('text-xs mt-1.5', msg.role === 'user' ? 'text-gold-100' : 'text-slate-400')}>
                {new Date(msg.ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2.5 animate-fade-up">
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center">
              <Bot className="w-4 h-4 text-gold-600" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 bg-gold-400 rounded-full"
                    style={{ animation: `dot-pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Quick Suggestions ── */}
      {messages.length <= 2 && (
        <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-2 mt-2">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => sendMessage(s)}
              className="flex-shrink-0 text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:border-gold-300 hover:text-gold-700 hover:bg-gold-50/50 transition-all whitespace-nowrap">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Speaking indicator ── */}
      {speaking && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-gold-50 border border-gold-200 rounded-xl mb-2">
          <Volume2 className="w-4 h-4 text-gold-600 animate-pulse" />
          <span className="text-xs text-gold-700 font-medium">يتحدث المساعد...</span>
          <button onClick={stopSpeaking} className="mr-auto text-xs text-gold-600 hover:text-gold-800 flex items-center gap-1">
            <X className="w-3 h-3" />إيقاف
          </button>
        </div>
      )}

      {/* ── Input ── */}
      <div className="flex-shrink-0 mt-2">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex items-end gap-2 p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="اكتب سؤالك هنا... (Enter للإرسال)"
            rows={1}
            className="flex-1 resize-none border-none outline-none text-sm text-slate-800 placeholder:text-slate-400 bg-transparent py-2 px-2 max-h-32 leading-relaxed"
            style={{ direction: 'rtl' }}
          />
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={listening ? stopListening : startListening}
              title={listening ? 'إيقاف الاستماع' : 'تحدث بصوتك'}
              className={cn('w-9 h-9 rounded-xl flex items-center justify-center transition-all border',
                listening
                  ? 'bg-red-500 text-white border-red-500 animate-pulse'
                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-gold-50 hover:text-gold-600 hover:border-gold-200')}>
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#8a6118,#4d350d)' }}>
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400 text-center mt-1.5">
          {listening ? '🎤 يستمع...' : 'اضغط على الميكروفون للتحدث بصوتك'}
        </p>
      </div>
    </div>
  );
};

export default AIAssistant;
