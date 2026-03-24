import { useState, useCallback } from "react";
import type { CheckIn } from "@/types/checkin";
import { useAuthContext } from "@/components/AuthProvider";

interface UseCheckInReturn {
  isLoading: boolean;
  error: string | null;
  checkIn: CheckIn | null;
  isVIP: boolean;
  createCheckIn: (superchargerId: string) => Promise<void>;
}

export function useCheckIn(): UseCheckInReturn {
  const { user, token } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null);
  const [isVIP, setIsVIP] = useState(false);

  const createCheckIn = useCallback(
    async (superchargerId: string) => {
      if (!user || !token) {
        setError("You must be logged in to check in");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/checkins", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ superchargerId }),
          credentials: "include",
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || "Check-in failed");
        }

        const data = await response.json();
        setCheckIn(data.checkIn);
        setIsVIP(data.isVIP || false);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Check-in failed";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [user, token]
  );

  return {
    isLoading,
    error,
    checkIn,
    isVIP,
    createCheckIn,
  };
}
