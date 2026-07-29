"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles as SparklesIcon,
  SunMoon as SunMoonIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Frosted "What's New" side panel. Slides in shortly after load, auto-hides
 * after a few minutes, and shows once per release: bump WHATS_NEW_ID when a
 * deployment ships something worth announcing and every device shows the
 * panel exactly once more.
 */
const WHATS_NEW_ID = "2026-07-29-reports-cameras-theme";
const STORAGE_KEY = "teslanav-whats-new-seen";
const SHOW_DELAY_MS = 2_500;
const AUTO_DISMISS_MS = 150_000; // ~2.5 minutes
const EXIT_ANIMATION_MS = 500;

interface WhatsNewEntry {
  image?: string;
  Icon?: LucideIcon;
  title: string;
  description: string;
}

const ENTRIES: WhatsNewEntry[] = [
  {
    image: "/icons/police.svg",
    title: "Report it yourself",
    description:
      "Tap the new Report button to drop police, hazards, and more at your location for other drivers.",
  },
  {
    image: "/icons/speed-camera.svg",
    title: "Speed & red-light cameras",
    description:
      "Fixed camera locations are now on the map. Toggle them in Settings.",
  },
  {
    Icon: SunMoonIcon,
    title: "Pick your theme",
    description:
      "Always light, always dark, or auto with sunrise and sunset — in Settings → Appearance.",
  },
];

export function WhatsNew({ isDarkMode }: { isDarkMode: boolean }) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const exitTimer = useRef<NodeJS.Timeout | null>(null);
  const autoDismissTimer = useRef<NodeJS.Timeout | null>(null);

  const dismiss = useCallback(() => {
    if (autoDismissTimer.current) {
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = null;
    }
    setIsVisible(false);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      setShouldRender(false);
    }, EXIT_ANIMATION_MS);
  }, []);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === WHATS_NEW_ID) return;

    const showTimer = setTimeout(() => {
      // Mark as seen when shown so it appears once per release per device.
      localStorage.setItem(STORAGE_KEY, WHATS_NEW_ID);
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      autoDismissTimer.current = setTimeout(() => {
        autoDismissTimer.current = null;
        dismiss();
      }, AUTO_DISMISS_MS);
    }, SHOW_DELAY_MS);

    return () => {
      clearTimeout(showTimer);
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [dismiss]);

  if (!shouldRender) return null;

  return (
    <aside
      className={`
        fixed left-4 top-24 z-40 w-[340px] max-w-[calc(100vw-2rem)]
        rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden
        ${isDarkMode ? "bg-[#1a1a1a]/55 border-white/10 text-white" : "bg-white/55 border-black/10 text-black"}
        transition-all duration-500 ease-out
        ${isVisible ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0"}
      `}
      aria-label="What's new in TeslaNav"
    >
      {/* Soft top highlight for the frosted-glass feel */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-16 ${
          isDarkMode
            ? "bg-gradient-to-b from-white/10 to-transparent"
            : "bg-gradient-to-b from-white/60 to-transparent"
        }`}
      />

      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold tracking-tight">What&apos;s New</h2>
          </div>
          <button
            onClick={dismiss}
            className={`
              w-9 h-9 -mr-1.5 rounded-lg flex items-center justify-center transition-colors
              ${isDarkMode ? "hover:bg-white/10 text-gray-400" : "hover:bg-black/5 text-gray-500"}
            `}
            aria-label="Dismiss what's new"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="space-y-4">
          {ENTRIES.map((entry) => (
            <li key={entry.title} className="flex items-start gap-3.5">
              <div className="w-9 shrink-0 flex justify-center mt-0.5">
                {entry.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.image}
                    alt=""
                    className="w-9 h-auto drop-shadow-sm"
                  />
                ) : entry.Icon ? (
                  <entry.Icon className="w-8 h-8 text-blue-400" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="font-semibold leading-snug">{entry.title}</div>
                <p
                  className={`text-sm leading-snug mt-0.5 ${
                    isDarkMode ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  {entry.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

