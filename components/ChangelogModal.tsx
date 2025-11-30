"use client";

import { useState, useEffect, useCallback } from "react";
import posthog from "posthog-js";

// Increment this version whenever you want to show the changelog again
const CHANGELOG_VERSION = "1";

interface ChangelogModalProps {
  isDarkMode: boolean;
}

export function ChangelogModal({ isDarkMode }: ChangelogModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // Check localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const seenVersion = localStorage.getItem("teslanav-changelog-version");
      if (seenVersion !== CHANGELOG_VERSION) {
        setIsOpen(true);
        posthog.capture("changelog_shown", { version: CHANGELOG_VERSION });
      }
    }
  }, []);

  // Handle animation states
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    // Mark as seen
    if (typeof window !== "undefined") {
      localStorage.setItem("teslanav-changelog-version", CHANGELOG_VERSION);
    }
    setIsOpen(false);
    posthog.capture("changelog_dismissed", { version: CHANGELOG_VERSION });
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center p-6
        transition-opacity duration-300 ease-out
        ${isVisible ? "opacity-100" : "opacity-0"}
      `}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div
        className={`
          absolute inset-0 bg-black/60 backdrop-blur-sm
          transition-opacity duration-300 ease-out
          ${isVisible ? "opacity-100" : "opacity-0"}
        `}
      />

      {/* Modal */}
      <div
        className={`
          relative w-full max-w-4xl max-h-[80vh] rounded-2xl overflow-hidden
          ${isDarkMode ? "bg-[#1a1a1a] text-white" : "bg-white text-black"}
          shadow-2xl flex flex-col
          transition-all duration-300 ease-out
          ${isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`
            flex items-center justify-between px-10 py-6 border-b
            ${isDarkMode ? "border-white/10" : "border-black/10"}
          `}
        >
          <h2 className="text-4xl font-semibold">What&apos;s New</h2>
          <button
            onClick={handleClose}
            className={`
              w-12 h-12 rounded-xl flex items-center justify-center
              ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
              transition-colors
            `}
            aria-label="Close changelog"
          >
            <CloseIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-10 py-8">
          <div className="space-y-10">
            {/* Version Header */}
            <div>
              <h3 className="text-2xl font-semibold mb-1">Version 0.2.0</h3>
              <p className={`text-base ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                November 2024
              </p>
            </div>

            {/* Changelog Items */}
            <div className="space-y-8">
              <div>
                <h4 className="text-xl font-medium mb-3">Real-time User Presence</h4>
                <p className={`text-lg leading-relaxed ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                  You can now see other TeslaNav users on the map in real-time. Look for the &quot;online&quot; badge in the top right corner showing how many users are currently active.
                </p>
              </div>

              <div>
                <h4 className="text-xl font-medium mb-3">Police Alert Improvements</h4>
                <p className={`text-lg leading-relaxed ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                  Police alerts now only trigger when a police report is ahead of you based on your direction of travel. This reduces unnecessary alerts when you&apos;ve already passed a reported location.
                </p>
              </div>

              <div>
                <h4 className="text-xl font-medium mb-3">Navigation Enhancements</h4>
                <p className={`text-lg leading-relaxed ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                  Search for a destination and preview it on the map before starting navigation. You can also long-press anywhere on the map to select that location as a destination.
                </p>
              </div>

              <div>
                <h4 className="text-xl font-medium mb-3">Auto-Rerouting</h4>
                <p className={`text-lg leading-relaxed ${isDarkMode ? "text-gray-300" : "text-gray-600"}`}>
                  When navigating, TeslaNav now automatically recalculates your route if you deviate from the planned path. No need to manually re-enter your destination.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`
            px-10 py-6 border-t
            ${isDarkMode ? "border-white/10" : "border-black/10"}
          `}
        >
          <button
            onClick={handleClose}
            className={`
              w-full h-16 rounded-xl font-medium text-xl
              bg-blue-500 text-white hover:bg-blue-600
              transition-all active:scale-[0.99]
            `}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

