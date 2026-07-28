"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics-client";
import type { UserReportType } from "@/lib/user-reports";
import type { WazeAlert } from "@/types/waze";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  latitude: number | null;
  longitude: number | null;
  onReported?: (alert: WazeAlert) => void;
}

interface ReportOption {
  type: UserReportType;
  label: string;
  icon: string;
  activeClasses: string;
}

// Same artwork and colors as the map markers (components/Map.tsx ALERT_*).
const REPORT_OPTIONS: ReportOption[] = [
  {
    type: "POLICE",
    label: "Police",
    icon: "/icons/police.svg",
    activeClasses: "border-blue-500/60 bg-blue-500/15",
  },
  {
    type: "ACCIDENT",
    label: "Accident",
    icon: "/icons/accident.svg",
    activeClasses: "border-red-500/60 bg-red-500/15",
  },
  {
    type: "HAZARD",
    label: "Hazard",
    icon: "/icons/hazard.svg",
    activeClasses: "border-amber-500/60 bg-amber-500/15",
  },
  {
    type: "ROAD_CLOSED",
    label: "Road closed",
    icon: "/icons/closure.svg",
    activeClasses: "border-gray-500/60 bg-gray-500/15",
  },
  {
    type: "JAM",
    label: "Traffic",
    icon: "/icons/object-on-road.svg",
    activeClasses: "border-violet-500/60 bg-violet-500/15",
  },
];

type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; type: UserReportType }
  | { status: "success"; merged: boolean }
  | { status: "error"; message: string };

export function ReportModal({
  isOpen,
  onClose,
  isDarkMode,
  latitude,
  longitude,
  onReported,
}: ReportModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const closeTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Mount closed on one frame, animate open on the next. State updates
      // stay inside rAF callbacks to avoid synchronous effect re-renders.
      const frame = requestAnimationFrame(() => {
        setShouldRender(true);
        setSubmitState({ status: "idle" });
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => {
      setIsVisible(false);
    });
    const timer = setTimeout(() => {
      setShouldRender(false);
    }, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const submitReport = useCallback(
    async (type: UserReportType) => {
      if (latitude === null || longitude === null) {
        setSubmitState({
          status: "error",
          message: "Your location is not available yet.",
        });
        return;
      }
      setSubmitState({ status: "submitting", type });
      try {
        const response = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, lat: latitude, lon: longitude }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setSubmitState({
            status: "error",
            message:
              typeof data.error === "string"
                ? data.error
                : "Unable to submit the report. Please try again.",
          });
          return;
        }
        if (data.alert) onReported?.(data.alert as WazeAlert);
        trackAnalyticsEvent("report_submitted", type);
        setSubmitState({ status: "success", merged: Boolean(data.merged) });
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null;
          onClose();
        }, 1400);
      } catch {
        setSubmitState({
          status: "error",
          message: "Unable to submit the report. Please try again.",
        });
      }
    },
    [latitude, longitude, onClose, onReported]
  );

  if (!shouldRender) return null;

  const isSubmitting = submitState.status === "submitting";

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-opacity duration-300 ease-out
        ${isVisible ? "opacity-100" : "opacity-0"}
      `}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className={`
          absolute inset-0 bg-black/50 backdrop-blur-sm
          transition-opacity duration-300 ease-out
          ${isVisible ? "opacity-100" : "opacity-0"}
        `}
      />

      {/* Modal */}
      <div
        className={`
          relative w-[90%] max-w-lg rounded-2xl overflow-hidden
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
            flex items-center justify-between px-6 py-5 border-b
            ${isDarkMode ? "border-white/10" : "border-black/10"}
          `}
        >
          <div>
            <h2 className="text-2xl font-semibold">Report</h2>
            <p className={`text-sm mt-0.5 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
              Dropped at your current location
            </p>
          </div>
          <button
            onClick={onClose}
            className={`
              w-12 h-12 rounded-xl flex items-center justify-center
              ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
              transition-colors
            `}
            aria-label="Close report menu"
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {submitState.status === "success" ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-9 h-9 text-green-500" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <p className="text-xl font-semibold">
                {submitState.merged
                  ? "Already reported — we confirmed it"
                  : "On the map — thanks!"}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {REPORT_OPTIONS.map((option) => {
                  const isActive =
                    submitState.status === "submitting" &&
                    submitState.type === option.type;
                  return (
                    <button
                      key={option.type}
                      onClick={() => submitReport(option.type)}
                      disabled={isSubmitting}
                      className={`
                        ${option.type === "JAM" ? "col-span-2" : ""}
                        h-24 rounded-xl border-2 flex items-center justify-center gap-3
                        transition-all duration-150 active:scale-95
                        disabled:opacity-60
                        ${isActive
                          ? option.activeClasses
                          : isDarkMode
                            ? "border-white/10 bg-white/5"
                            : "border-black/10 bg-black/[0.03]"}
                      `}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={option.icon}
                        alt=""
                        className={`w-11 h-auto ${isActive ? "animate-pulse" : ""}`}
                      />
                      <span className="text-lg font-semibold">{option.label}</span>
                    </button>
                  );
                })}
              </div>
              {submitState.status === "error" && (
                <p className="mt-4 text-center text-sm font-medium text-red-500">
                  {submitState.message}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
