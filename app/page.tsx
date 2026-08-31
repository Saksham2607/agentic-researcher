'use client';

import { useChat } from '@ai-sdk/react';
import { useState, useEffect } from 'react';

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');

  const isThinking = status === 'submitted' || status === 'streaming';

  return (
    <div
      className="h-screen flex flex-col bg-[#0A0E14] relative overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(#2E7FE01A 1px, transparent 1px), linear-gradient(90deg, #2E7FE01A 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    >
      {/* Top status bar */}
      <header className="shrink-0 flex items-center justify-between px-8 py-4 border-b border-[#2E7FE0]/25 bg-[#0F1620]/70 backdrop-blur-md z-10">
        <div>
          <h1 className="font-[family-name:var(--font-orbitron)] text-[#4FD8EB] tracking-[0.25em] text-sm uppercase drop-shadow-[0_0_6px_#4FD8EB]">
            Research Agent
          </h1>
          <p className="font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.15em] text-[#FFB454]/70 mt-1">
            FUNDAMENTALS // UNDERSTANDING MODULE
          </p>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-[family-name:var(--font-mono-hud)] text-[10px] tracking-widest text-[#5A7A8A]">
            {isThinking ? 'PROCESSING' : 'STANDBY'}
          </span>

          {/* Core instrument: concentric rings */}
          <div className="relative h-16 w-16">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: '1px dashed #4FD8EB40',
                animation: 'spin 20s linear infinite',
              }}
            />
            <div
              className="absolute inset-[4px] rounded-full border border-[#4FD8EB]/20"
              style={{
                borderTopColor: isThinking ? '#4FD8EB' : '#4FD8EB55',
                borderRightColor: 'transparent',
                animation: `spin ${isThinking ? '1.2s' : '4s'} linear infinite`,
              }}
            />
            <div
              className="absolute inset-[11px] rounded-full border border-[#FFB454]/20"
              style={{
                borderBottomColor: isThinking ? '#FFB454' : '#FFB45440',
                borderLeftColor: 'transparent',
                animation: `spin ${isThinking ? '0.9s' : '3s'} linear infinite reverse`,
              }}
            />
            <div className="absolute inset-[22px] rounded-full bg-[#4FD8EB]/80 shadow-[0_0_10px_3px_#4FD8EB]" />
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left telemetry strip */}
        <TelemetryStrip side="left" active={isThinking} />

        {/* Message log */}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="max-w-2xl mx-auto w-full space-y-6">
            {messages.length === 0 && (
              <div className="mt-16 flex flex-col items-center text-center gap-3">
                <div className="font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.3em] text-[#FFB454]/80 border border-[#FFB454]/30 rounded px-3 py-1">
                  SYSTEM READY
                </div>
                <p className="font-[family-name:var(--font-inter)] text-sm text-[#5A7A8A] max-w-xs">
                  Give it a topic. It'll pull fundamentals and help you build understanding from there.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className="flex gap-3 animate-[fadeIn_0.3s_ease-out]"
              >
                {/* Avatar marker */}
                <div
                  className={`shrink-0 h-7 w-7 mt-0.5 flex items-center justify-center text-[10px] font-[family-name:var(--font-mono-hud)] ${
                    message.role === 'user'
                      ? 'text-[#FFB454] border border-[#FFB454]/50'
                      : 'text-[#4FD8EB] border border-[#4FD8EB]/60 shadow-[0_0_10px_-2px_#4FD8EB]'
                  }`}
                  style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                >
                  {message.role === 'user' ? 'U' : 'A'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className={`font-[family-name:var(--font-mono-hud)] text-[10px] tracking-[0.15em] uppercase ${
                        message.role === 'user' ? 'text-[#FFB454]/80' : 'text-[#4FD8EB]/90'
                      }`}
                    >
                      {message.role === 'user' ? 'You' : 'Agent'}
                    </span>
                  </div>
                  <div className="font-[family-name:var(--font-inter)] text-[#E8F4F8] text-sm leading-relaxed whitespace-pre-wrap">
                    {message.parts.map((part, i) =>
                      part.type === 'text' ? <span key={i}>{part.text}</span> : null
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isThinking && (
              <div className="flex gap-3">
                <div
                  className="shrink-0 h-7 w-7 mt-0.5 flex items-center justify-center text-[10px] font-[family-name:var(--font-mono-hud)] text-[#4FD8EB] border border-[#4FD8EB]/60"
                  style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                >
                  A
                </div>
                <div className="flex items-center gap-1 h-7">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="w-1 bg-[#4FD8EB] rounded-full"
                      style={{
                        height: '14px',
                        animation: `waveform 0.9s ease-in-out ${i * 0.15}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right telemetry strip */}
        <TelemetryStrip side="right" active={isThinking} />
      </div>

      {/* Input bar */}
      <footer className="shrink-0 border-t border-[#2E7FE0]/25 bg-[#0F1620]/70 backdrop-blur-md px-8 py-5 z-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() === '') return;
            sendMessage({ text: input });
            setInput('');
          }}
          className="max-w-2xl mx-auto w-full flex items-center gap-3"
        >
          <span className="font-[family-name:var(--font-mono-hud)] text-[#FFB454]">
            &gt;
          </span>
          <input
            className="flex-1 bg-transparent font-[family-name:var(--font-inter)] text-[#E8F4F8] placeholder:text-[#5A7A8A] outline-none text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask something..."
          />
          <button
            type="submit"
            className="font-[family-name:var(--font-mono-hud)] text-xs uppercase tracking-widest text-[#4FD8EB] border border-[#4FD8EB]/50 px-5 py-2.5 rounded hover:bg-[#4FD8EB]/10 hover:border-[#4FD8EB] transition-colors"
          >
            Send
          </button>
        </form>
      </footer>

      <style jsx global>{`
        @keyframes waveform {
          0%, 100% { height: 5px; }
          50% { height: 18px; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function TelemetryStrip({ side, active }: { side: 'left' | 'right'; active: boolean }) {
  const [values, setValues] = useState([87, 42, 118, 92]);

  useEffect(() => {
    const interval = setInterval(() => {
      setValues((prev) => prev.map((v) => {
        const next = v + (Math.random() * 10 - 5);
        return Math.max(5, Math.min(100, Math.round(next)));
      }));
    }, 1400);

    return () => clearInterval(interval);
  }, []);

  const rows = ['SIG', 'BW', 'LAT', 'SYN'];

  return (
    <div
      className={`hidden lg:flex flex-col justify-center gap-7 w-20 shrink-0 px-3 ${
        side === 'left' ? 'border-r' : 'border-l'
      } border-[#2E7FE0]/15`}
    >
      {rows.map((label, i) => (
        <div key={label} className="font-[family-name:var(--font-mono-hud)]">
          <div className="flex items-baseline justify-between text-[9px] text-[#5A7A8A] tracking-widest mb-1.5">
            <span>{label}</span>
            <span className={active ? 'text-[#4FD8EB]' : 'text-[#5A7A8A]'}>
              {values[i]}
            </span>
          </div>
          <div className="h-1 w-full bg-[#5A7A8A]/15 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                active ? 'bg-[#4FD8EB]' : 'bg-[#5A7A8A]/50'
              }`}
              style={{ width: `${values[i]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}