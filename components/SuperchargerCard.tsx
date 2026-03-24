"use client";

import { Supercharger, SuperchargerAvailability } from "@/types/supercharger";
import { useCheckIn } from "@/hooks/useCheckIn";
import { useAuthContext } from "./AuthProvider";
import { BoltIcon, MapPinIcon, SparklesIcon } from "@heroicons/react/24/solid";

interface SuperchargerCardProps {
  supercharger: Supercharger;
  availability?: SuperchargerAvailability | null;
  isVIP?: boolean;
  userCheckInCount?: number;
  onCheckInSuccess?: () => void;
  darkMode?: boolean;
}

export function SuperchargerCard({
  supercharger,
  availability,
  isVIP = false,
  userCheckInCount = 0,
  onCheckInSuccess,
  darkMode = false,
}: SuperchargerCardProps) {
  const { user } = useAuthContext();
  const { isLoading, error, createCheckIn } = useCheckIn();

  const handleCheckIn = async () => {
    await createCheckIn(supercharger.id);
    onCheckInSuccess?.();
  };

  const bgClass = darkMode
    ? "bg-[#2a2a2a] text-white border-white/10"
    : "bg-white text-black border-black/10";

  const buttonClass = darkMode
    ? "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
    : "bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50";

  return (
    <div className={`${bgClass} border rounded-lg p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-lg">{supercharger.name}</h3>
          <div className="flex items-center gap-1 text-sm opacity-70 mt-1">
            <MapPinIcon className="w-4 h-4" />
            {supercharger.city}, {supercharger.state}
          </div>
        </div>
        {isVIP && (
          <div className="flex items-center gap-1 bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-xs font-medium">
            <SparklesIcon className="w-4 h-4" />
            VIP
          </div>
        )}
      </div>

      {/* Specs */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="opacity-70">Stalls</div>
          <div className="font-semibold">{supercharger.stallCount}</div>
        </div>
        {availability && (
          <div>
            <div className="opacity-70">Available</div>
            <div className="font-semibold">
              {availability.availableStalls}/{availability.totalStalls}
            </div>
          </div>
        )}
        <div>
          <div className="opacity-70">Power</div>
          <div className="font-semibold">{supercharger.maxPower}kW</div>
        </div>
        {userCheckInCount > 0 && (
          <div>
            <div className="opacity-70">Your Check-ins</div>
            <div className="font-semibold">{userCheckInCount}</div>
          </div>
        )}
      </div>

      {/* Amenities */}
      {supercharger.amenities && supercharger.amenities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {supercharger.amenities.map((amenity) => (
            <span
              key={amenity}
              className={`text-xs px-2 py-1 rounded ${
                darkMode ? "bg-white/10" : "bg-black/10"
              }`}
            >
              {amenity}
            </span>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">{error}</div>
      )}

      {/* Check-in Button */}
      {user ? (
        <button
          onClick={handleCheckIn}
          disabled={isLoading}
          className={`w-full py-2 rounded font-medium transition flex items-center justify-center gap-2 ${buttonClass}`}
        >
          <BoltIcon className="w-4 h-4" />
          {isLoading ? "Checking in..." : "Check In"}
        </button>
      ) : (
        <div className="text-sm text-center opacity-70 py-2">
          Sign in to check in
        </div>
      )}
    </div>
  );
}
