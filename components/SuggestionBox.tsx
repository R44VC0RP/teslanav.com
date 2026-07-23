"use client";

import { useEffect, useRef, useState } from "react";
import { Lightbulb, Send } from "lucide-react";
import { trackAnalyticsEvent } from "@/lib/analytics-client";

interface SuggestionBoxProps {
  isDarkMode: boolean;
}

export function SuggestionBox({ isDarkMode }: SuggestionBoxProps) {
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const startedAtRef = useRef(0);
  const submissionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      startedAtRef.current = Date.now();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const suggestion = message.trim();
    if (suggestion.length < 10 || status === "sending") return;

    setStatus("sending");
    setError("");
    submissionIdRef.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submissionIdRef.current,
          message: suggestion,
          honeypot,
          startedAt: startedAtRef.current,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to send suggestion");

      setStatus("success");
      setMessage("");
      submissionIdRef.current = null;
      startedAtRef.current = Date.now();
      trackAnalyticsEvent("suggestion_sent");
      window.setTimeout(() => setStatus("idle"), 4000);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Unable to send suggestion");
    }
  };

  return (
    <section>
      <h3 className={`text-base font-medium uppercase tracking-wider mb-4 ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
        Suggestion box
      </h3>
      <form
        onSubmit={submit}
        className={`rounded-xl p-5 ${isDarkMode ? "bg-white/5" : "bg-black/5"}`}
      >
        <div className="flex items-start gap-4 mb-4">
          <Lightbulb className="w-8 h-8 text-amber-400 flex-shrink-0" />
          <div>
            <div className="text-lg font-medium">Help shape TeslaNav</div>
            <p className={`text-base text-pretty ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
              Drop an idea, improvement, or something that feels broken.
            </p>
          </div>
        </div>

        <label htmlFor="teslanav-suggestion" className="sr-only">
          Your suggestion
        </label>
        <textarea
          id="teslanav-suggestion"
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (status === "error") setStatus("idle");
          }}
          maxLength={2000}
          rows={5}
          placeholder="I think TeslaNav should…"
          className={`w-full resize-none rounded-xl p-4 text-base leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${
            isDarkMode
              ? "bg-black/25 text-white placeholder:text-white/35"
              : "bg-white text-black placeholder:text-black/35"
          }`}
        />

        {/* Honeypot: real users and assistive technology never interact with it. */}
        <label className="absolute -left-[10000px]" aria-hidden="true">
          Website
          <input
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </label>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="min-h-5 text-sm">
            {status === "success" && (
              <span className="text-green-500">Sent — thank you.</span>
            )}
            {status === "error" && <span className="text-red-400">{error}</span>}
            {status === "idle" && (
              <span className={isDarkMode ? "text-white/35" : "text-black/40"}>
                {message.length.toLocaleString()} / 2,000
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={message.trim().length < 10 || status === "sending"}
            className="min-h-11 flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 font-medium text-white transition-[background-color,scale,opacity] hover:bg-blue-600 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
            {status === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
