"use client";

import { useState, useCallback } from "react";
import posthog from "posthog-js";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

export function FeedbackModal({ isOpen, onClose, isDarkMode }: FeedbackModalProps) {
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState(""); // Anti-spam honeypot field
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = useCallback(async () => {
    if (!feedback.trim()) return;

    setIsSubmitting(true);
    setSubmitStatus("idle");
    setErrorMessage("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feedback: feedback.trim(),
          email: email.trim() || undefined,
          honeypot, // Send honeypot field (should be empty for real users)
        }),
      });

      if (response.ok) {
        setSubmitStatus("success");
        posthog.capture("feedback_submitted", {
          has_email: !!email.trim(),
          feedback_length: feedback.length,
        });

        // Auto-close after success
        setTimeout(() => {
          setFeedback("");
          setEmail("");
          setSubmitStatus("idle");
          onClose();
        }, 2000);
      } else {
        const data = await response.json();
        setErrorMessage(data.error || "Failed to send feedback");
        setSubmitStatus("error");
      }
    } catch (error) {
      console.error("Feedback submission error:", error);
      setErrorMessage("Network error. Please try again.");
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [feedback, email, honeypot, onClose]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setFeedback("");
      setEmail("");
      setSubmitStatus("idle");
      setErrorMessage("");
      onClose();
    }
  }, [isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={`
          relative w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden
          ${isDarkMode ? "bg-[#1a1a1a] text-white" : "bg-white text-black"}
          border ${isDarkMode ? "border-white/10" : "border-black/10"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-6 py-5 border-b ${isDarkMode ? "border-white/10" : "border-black/10"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${isDarkMode ? "bg-blue-500/20" : "bg-blue-500/10"}`}>
                <FeedbackIcon className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Send Feedback</h2>
                <p className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Help us improve TeslaNav
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className={`
                p-2 rounded-xl transition-colors
                ${isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"}
                disabled:opacity-50
              `}
              aria-label="Close"
            >
              <CloseIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Known Issue Notice */}
          <div className={`
            flex items-start gap-3 p-4 rounded-xl
            ${isDarkMode ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-50 border border-amber-200"}
          `}>
            <span className="text-xl flex-shrink-0">🔧</span>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? "text-amber-200" : "text-amber-800"}`}>
                Known Issue: Search & Navigation
              </p>
              <p className={`text-xs mt-1 ${isDarkMode ? "text-amber-200/70" : "text-amber-700"}`}>
                We&apos;re aware that search and navigation features are currently not working. A fix is in progress!
              </p>
            </div>
          </div>

          {submitStatus === "success" ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckIcon className="w-8 h-8 text-green-500" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold">Thank you!</p>
                <p className={`text-sm ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                  Your feedback has been sent successfully.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Feedback textarea */}
              <div>
                <label
                  htmlFor="feedback"
                  className={`block text-sm font-medium mb-2 ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}
                >
                  Your Feedback <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="feedback"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Tell us what you think, report a bug, or suggest a feature..."
                  rows={5}
                  maxLength={5000}
                  disabled={isSubmitting}
                  className={`
                    w-full px-4 py-3 rounded-xl border resize-none
                    ${isDarkMode
                      ? "bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-blue-500/50"
                      : "bg-black/5 border-black/10 text-black placeholder-gray-400 focus:border-blue-500/50"
                    }
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20
                    transition-colors disabled:opacity-50
                    text-base
                  `}
                />
                <div className={`text-xs mt-1 text-right ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  {feedback.length}/5000
                </div>
              </div>

              {/* Optional email */}
              <div>
                <label
                  htmlFor="email"
                  className={`block text-sm font-medium mb-2 ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}
                >
                  Your Email <span className={isDarkMode ? "text-gray-500" : "text-gray-400"}>(optional)</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  disabled={isSubmitting}
                  className={`
                    w-full px-4 py-3 rounded-xl border
                    ${isDarkMode
                      ? "bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-blue-500/50"
                      : "bg-black/5 border-black/10 text-black placeholder-gray-400 focus:border-blue-500/50"
                    }
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20
                    transition-colors disabled:opacity-50
                    text-base
                  `}
                />
                <p className={`text-xs mt-1 ${isDarkMode ? "text-gray-500" : "text-gray-400"}`}>
                  Include if you&apos;d like a response
                </p>
              </div>

              {/* Honeypot field - hidden from users, only bots will fill this */}
              <div className="absolute -left-[9999px]" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  type="text"
                  name="website"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              {/* Error message */}
              {submitStatus === "error" && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-500">
                  <ErrorIcon className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{errorMessage}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {submitStatus !== "success" && (
          <div className={`px-6 py-4 border-t ${isDarkMode ? "border-white/10" : "border-black/10"}`}>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className={`
                  flex-1 h-14 rounded-xl font-medium text-lg
                  ${isDarkMode ? "bg-white/10 hover:bg-white/15" : "bg-black/5 hover:bg-black/10"}
                  transition-colors disabled:opacity-50
                `}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !feedback.trim()}
                className={`
                  flex-1 h-14 rounded-xl font-medium text-lg
                  bg-blue-500 text-white hover:bg-blue-600
                  transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2
                `}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <SendIcon className="w-5 h-5" />
                    Send Feedback
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

