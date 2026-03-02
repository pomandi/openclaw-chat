'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type HeadState = 'idle' | 'listening' | 'recording' | 'thinking' | 'speaking';

interface TalkingHeadProps {
  state: HeadState;
  mouthOpenness: number; // 0 to 1
  size?: number;
  accentColor?: string;
}

export default function TalkingHead({
  state,
  mouthOpenness,
  size = 96,
  accentColor = 'var(--accent)',
}: TalkingHeadProps) {
  const [blinkState, setBlinkState] = useState(false);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Periodic blink every 3-6s
  const scheduleBlink = useCallback(() => {
    const delay = 3000 + Math.random() * 3000;
    blinkTimerRef.current = setTimeout(() => {
      setBlinkState(true);
      setTimeout(() => {
        setBlinkState(false);
        scheduleBlink();
      }, 150);
    }, delay);
  }, []);

  useEffect(() => {
    scheduleBlink();
    return () => {
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
    };
  }, [scheduleBlink]);

  // Eye dimensions based on state
  const eyeRx = state === 'recording' ? 4.5 : state === 'speaking' ? 3.2 : 3.5;
  const eyeRy = blinkState ? 0.5 : state === 'recording' ? 5 : state === 'speaking' ? 3.5 : 4;

  // Mouth shape based on mouthOpenness
  const mouthOpen = state === 'speaking' ? mouthOpenness : state === 'recording' ? 0.15 : 0;
  const mouthY = 58;
  const mouthWidth = 8;
  const mouthHeight = mouthOpen * 7;

  // Animation class
  const animClass =
    state === 'speaking' ? 'head-bob' :
    state === 'thinking' ? 'head-think' :
    'head-breathe';

  return (
    <div className={animClass} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 96 96"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Head circle */}
        <circle
          cx="48"
          cy="48"
          r="40"
          fill="var(--bg-tertiary)"
          stroke={accentColor}
          strokeWidth="2"
        />

        {/* Left eye */}
        <ellipse
          cx="36"
          cy="42"
          rx={eyeRx}
          ry={eyeRy}
          fill="var(--text-primary)"
          style={{ transition: 'rx 0.2s, ry 0.1s' }}
        />

        {/* Right eye */}
        <ellipse
          cx="60"
          cy="42"
          rx={eyeRx}
          ry={eyeRy}
          fill="var(--text-primary)"
          style={{ transition: 'rx 0.2s, ry 0.1s' }}
        />

        {/* Pupils */}
        <circle cx="36" cy="42" r="1.5" fill="var(--bg-primary)" opacity={blinkState ? 0 : 1} />
        <circle cx="60" cy="42" r="1.5" fill="var(--bg-primary)" opacity={blinkState ? 0 : 1} />

        {/* Mouth */}
        {mouthHeight < 1 ? (
          // Closed mouth — line
          <line
            x1={48 - mouthWidth}
            y1={mouthY}
            x2={48 + mouthWidth}
            y2={mouthY}
            stroke="var(--text-primary)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          // Open mouth — ellipse
          <ellipse
            cx="48"
            cy={mouthY}
            rx={mouthWidth}
            ry={mouthHeight}
            fill="var(--bg-primary)"
            stroke="var(--text-primary)"
            strokeWidth="1.5"
            style={{ transition: 'ry 0.05s' }}
          />
        )}

        {/* Cheek blush when speaking */}
        {state === 'speaking' && (
          <>
            <circle cx="26" cy="52" r="5" fill={accentColor} opacity="0.12" />
            <circle cx="70" cy="52" r="5" fill={accentColor} opacity="0.12" />
          </>
        )}
      </svg>
    </div>
  );
}
