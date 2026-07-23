"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface ConfettiPiece {
  side: "left" | "right";
  top: number;
  width: number;
  height: number;
  color: string;
  delay: number;
  duration: number;
  midX: number;
  midY: number;
  endX: number;
  endY: number;
  turn: number;
  round: boolean;
}

const STORAGE_KEY = "teslanav-welcome-back-seen";
const CONFETTI_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f8fafc",
];

const CONFETTI: ConfettiPiece[] = (["left", "right"] as const).flatMap(
  (side, sideIndex) =>
    Array.from({ length: 38 }, (_, index) => {
      const seed = index * 47 + sideIndex * 23;
      return {
        side,
        top: 18 + ((seed * 13) % 64),
        width: 6 + (seed % 6),
        height: index % 3 === 0 ? 6 + (seed % 5) : 12 + (seed % 8),
        color: CONFETTI_COLORS[(index + sideIndex * 2) % CONFETTI_COLORS.length],
        delay: (index % 10) * 32 + Math.floor(index / 10) * 18,
        duration: 1750 + (seed % 850),
        midX: 18 + (seed % 24),
        midY: -(12 + ((seed * 3) % 38)),
        endX: 45 + ((seed * 7) % 48),
        endY: 25 + ((seed * 5) % 65),
        turn: 540 + ((seed * 11) % 900),
        round: index % 5 === 0,
      };
    })
);

type ConfettiStyle = CSSProperties & Record<`--${string}`, string>;

export function WelcomeBackFanfare() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let hideTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      const forcePreview =
        process.env.NODE_ENV === "development" &&
        new URLSearchParams(window.location.search).get("welcome") === "1";

      if (!forcePreview) {
        try {
          if (localStorage.getItem(STORAGE_KEY)) return;
          localStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // Do not risk replaying a lifetime-only fanfare if storage is unavailable.
          return;
        }
      }

      setIsVisible(true);
      hideTimer = window.setTimeout(() => setIsVisible(false), 4200);
    }, 120);

    return () => {
      window.clearTimeout(startTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className="welcome-fanfare fixed inset-0 z-[100] overflow-hidden pointer-events-none"
      role="status"
      aria-live="polite"
      aria-label="We're back. Welcome back."
    >
      <div
        className="welcome-fanfare-glow absolute left-1/2 top-1/2 h-[min(70vw,700px)] w-[min(70vw,700px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 blur-3xl"
        aria-hidden="true"
      />

      <div className="welcome-fanfare-confetti absolute inset-0" aria-hidden="true">
        {CONFETTI.map((piece, index) => {
          const direction = piece.side === "left" ? 1 : -1;
          const style: ConfettiStyle = {
            top: `${piece.top}%`,
            left: piece.side === "left" ? "-14px" : undefined,
            right: piece.side === "right" ? "-14px" : undefined,
            width: `${piece.width}px`,
            height: `${piece.height}px`,
            borderRadius: piece.round ? "999px" : "2px",
            backgroundColor: piece.color,
            "--confetti-delay": `${piece.delay}ms`,
            "--confetti-duration": `${piece.duration}ms`,
            "--confetti-mid-x": `${piece.midX * direction}vw`,
            "--confetti-mid-y": `${piece.midY}vh`,
            "--confetti-end-x": `${piece.endX * direction}vw`,
            "--confetti-end-y": `${piece.endY}vh`,
            "--confetti-mid-turn": `${piece.turn * direction * 0.48}deg`,
            "--confetti-turn": `${piece.turn * direction}deg`,
          };
          return (
            <span
              key={`${piece.side}-${index}`}
              className="welcome-confetti-piece absolute"
              style={style}
            />
          );
        })}
      </div>

      <div
        className="welcome-fanfare-copy absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white"
      >
        <div className="text-[clamp(3.25rem,9vw,7.5rem)] font-black leading-[0.9] tracking-[-0.055em] drop-shadow-[0_4px_18px_rgba(0,0,0,0.75)]">
          We&apos;re back
        </div>
        <div className="mt-5 text-[clamp(1.1rem,2.4vw,1.75rem)] font-medium tracking-[-0.02em] text-white/90 drop-shadow-[0_3px_12px_rgba(0,0,0,0.8)]">
          Welcome back
        </div>
      </div>

      <style jsx>{`
        .welcome-fanfare {
          animation: welcome-overlay 4200ms linear both;
        }

        .welcome-fanfare-glow {
          animation: welcome-glow 4200ms cubic-bezier(0.2, 0, 0, 1) both;
        }

        .welcome-fanfare-copy {
          animation: welcome-copy 4200ms cubic-bezier(0.2, 0, 0, 1) both;
          will-change: transform, opacity, filter;
        }

        .welcome-confetti-piece {
          animation: welcome-confetti var(--confetti-duration)
            cubic-bezier(0.16, 0.7, 0.25, 1) var(--confetti-delay) both;
          box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
          will-change: transform, opacity;
        }

        @keyframes welcome-overlay {
          0%, 88% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes welcome-glow {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.65);
          }
          14%, 72% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.08);
          }
        }

        @keyframes welcome-copy {
          0% {
            opacity: 0;
            filter: blur(8px);
            transform: translateY(16px) scale(0.86);
          }
          14%, 72% {
            opacity: 1;
            filter: blur(0);
            transform: translateY(0) scale(1);
          }
          88%, 100% {
            opacity: 0;
            filter: blur(3px);
            transform: translateY(-8px) scale(1.02);
          }
        }

        @keyframes welcome-confetti {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) rotate(0deg) scale(0.5);
          }
          8% {
            opacity: 1;
          }
          48% {
            opacity: 1;
            transform: translate3d(
                var(--confetti-mid-x),
                var(--confetti-mid-y),
                0
              )
              rotate(var(--confetti-mid-turn)) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate3d(
                var(--confetti-end-x),
                var(--confetti-end-y),
                0
              )
              rotate(var(--confetti-turn)) scale(0.78);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .welcome-fanfare,
          .welcome-fanfare-glow,
          .welcome-fanfare-copy {
            animation: none;
          }

          .welcome-fanfare-confetti {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
