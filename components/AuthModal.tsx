"use client";

import { useState, useCallback } from "react";
import { useAuthContext } from "./AuthProvider";
import { EnvelopeIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

export function AuthModal({ isOpen, onClose, darkMode = false }: AuthModalProps) {
  const { login, register, error, isLoading } = useAuthContext();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      try {
        if (mode === "login") {
          await login(email, password);
        } else {
          await register(email, password, name);
        }
        onClose();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Authentication failed");
      }
    },
    [mode, email, password, name, login, register, onClose]
  );

  if (!isOpen) return null;

  const handleGoogleLogin = () => {
    // TODO: Implement Google OAuth flow
    console.log("Google login");
  };

  const handleAppleLogin = () => {
    // TODO: Implement Apple OAuth flow
    console.log("Apple login");
  };

  const bgClass = darkMode
    ? "bg-[#1a1a1a]/95 text-white border-white/10"
    : "bg-white/95 text-black border-black/10";

  const inputClass = darkMode
    ? "bg-[#2a2a2a] text-white border-white/20 placeholder-white/50"
    : "bg-white/50 text-black border-black/20 placeholder-black/50";

  const buttonClass = darkMode
    ? "bg-blue-600 hover:bg-blue-700 text-white"
    : "bg-blue-500 hover:bg-blue-600 text-white";

  const secondaryButtonClass = darkMode
    ? "bg-white/10 hover:bg-white/20 text-white"
    : "bg-black/10 hover:bg-black/20 text-black";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        className={`${bgClass} border rounded-lg p-6 w-full max-w-md shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">
            {mode === "login" ? "Sign In" : "Create Account"}
          </h2>
          <button
            onClick={onClose}
            className="text-xl hover:opacity-70 transition"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Error Message */}
        {(error || localError) && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error || localError}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          {mode === "register" && (
            <input
              type="text"
              placeholder="Full Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full px-4 py-2 border rounded transition ${inputClass}`}
              disabled={isLoading}
            />
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={`w-full px-4 py-2 border rounded transition ${inputClass}`}
            disabled={isLoading}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={`w-full px-4 py-2 border rounded transition ${inputClass}`}
            disabled={isLoading}
          />

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-2 rounded font-medium transition disabled:opacity-50 ${buttonClass}`}
          >
            {isLoading
              ? "Please wait..."
              : mode === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        {/* OAuth Buttons */}
        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className={`w-full py-2 rounded font-medium transition flex items-center justify-center gap-2 ${secondaryButtonClass} disabled:opacity-50`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </button>

          <button
            type="button"
            onClick={handleAppleLogin}
            disabled={isLoading}
            className={`w-full py-2 rounded font-medium transition flex items-center justify-center gap-2 ${secondaryButtonClass} disabled:opacity-50`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 13.5c-.91 2.92.37 5.65 2.85 6.75-1.08 1.6-2.72 2.56-4.75 2.56-3.37 0-6.25-2.73-6.25-6.1 0-3.37 2.88-6.1 6.25-6.1 1.41 0 2.77.46 3.9 1.37l-1.53 1.53c-.77-.72-1.87-1.15-3.05-1.15-2.51 0-4.58 2.08-4.58 4.65s2.07 4.65 4.58 4.65c1.55 0 2.95-.68 3.86-1.76.7-.8 1.12-1.82 1.12-2.93h-5v-2v.08z" />
              <path d="M9.17 7.5c-1.19 0-2.31.45-3.17 1.22-1.75 1.6-1.97 4.14-.53 6.1.92 1.28 2.36 2.11 3.95 2.11.95 0 1.83-.31 2.55-.87l1.53-1.53c-1.13.91-2.49 1.37-3.9 1.37-2.51 0-4.58-2.08-4.58-4.65s2.07-4.65 4.58-4.65c1.62 0 3.05.86 3.85 2.15l1.53-1.53C12.13 8.25 10.72 7.5 9.17 7.5" />
            </svg>
            Apple
          </button>
        </div>

        {/* Toggle */}
        <div className="text-center">
          <p className="text-sm opacity-70">
            {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-blue-500 hover:text-blue-400 font-medium"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
