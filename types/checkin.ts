export interface CheckIn {
  userId: string;
  superchargerId: string;
  timestamp: number;
  count: number; // Total check-ins at this location by this user
}

export interface CheckInResponse {
  success: boolean;
  checkIn?: CheckIn;
  isVIP?: boolean;
  message?: string;
}

export interface UserStats {
  userId: string;
  email: string;
  totalCheckIns: number;
  vipLocations: string[]; // Supercharger IDs where user is VIP
  vipCount: number;
  lastCheckIn?: number;
}

export interface LeaderboardEntry {
  userId: string;
  email: string;
  name?: string;
  checkInCount: number;
  isVIP: boolean;
  rank: number;
}

export interface LocationLeaderboard {
  superchargerId: string;
  superchargerName: string;
  entries: LeaderboardEntry[];
  vipUserId?: string;
  vipUserEmail?: string;
}
