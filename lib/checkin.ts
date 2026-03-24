import { redis, CACHE_KEYS } from "./redis";
import { CheckIn, UserStats, LeaderboardEntry, LocationLeaderboard } from "@/types/checkin";

/**
 * Create a check-in for user at supercharger
 */
export async function createCheckIn(
  userId: string,
  superchargerId: string
): Promise<CheckIn> {
  const timestamp = Date.now();

  // Increment check-in count for user at location
  const countKey = `${CACHE_KEYS.CHECKIN}${userId}:${superchargerId}`;
  const count = await redis.incr(countKey);

  // Add to location checkins (sorted set for leaderboard)
  const locationKey = `${CACHE_KEYS.LOCATION_CHECKINS}${superchargerId}`;
  await redis.zadd(locationKey, { score: count, member: userId });

  // Track which locations user has checked in at
  const userCheckinsKey = `${CACHE_KEYS.USER_CHECKINS}${userId}`;
  await redis.sadd(userCheckinsKey, superchargerId);

  // Update total check-ins in user stats
  const statsKey = `${CACHE_KEYS.USER_STATS}${userId}`;
  const totalKey = `${statsKey}:total`;
  await redis.incr(totalKey);

  // Recalculate VIP status
  await recalculateVIP(superchargerId, userId);

  const checkIn: CheckIn = {
    userId,
    superchargerId,
    timestamp,
    count,
  };

  return checkIn;
}

/**
 * Get check-in count for user at location
 */
export async function getCheckInCount(userId: string, superchargerId: string): Promise<number> {
  const key = `${CACHE_KEYS.CHECKIN}${userId}:${superchargerId}`;
  const count = await redis.get<number>(key);
  return count || 0;
}

/**
 * Get all locations user has checked in at
 */
export async function getUserCheckInLocations(userId: string): Promise<string[]> {
  const key = `${CACHE_KEYS.USER_CHECKINS}${userId}`;
  const locations = await redis.smembers<string[]>(key);
  return locations || [];
}

/**
 * Recalculate VIP status for a location
 */
export async function recalculateVIP(superchargerId: string, userId?: string): Promise<string | null> {
  const locationKey = `${CACHE_KEYS.LOCATION_CHECKINS}${superchargerId}`;

  // Get the user with most check-ins
  const topUsers = (await redis.zrange(locationKey, 0, 0, { rev: true })) as string[] | null;

  if (!topUsers || topUsers.length === 0) {
    return null;
  }

  const vipUserId = topUsers[0];
  const vipKey = `${CACHE_KEYS.LOCATION_VIP}${superchargerId}`;

  // Store VIP user ID
  await redis.set(vipKey, vipUserId);

  // Update user's VIP locations
  const userVipKey = `${CACHE_KEYS.USER_VIP_LOCATIONS}${vipUserId}`;
  await redis.sadd(userVipKey, superchargerId);

  return vipUserId;
}

/**
 * Get VIP user for a location
 */
export async function getVIPUser(superchargerId: string): Promise<string | null> {
  const key = `${CACHE_KEYS.LOCATION_VIP}${superchargerId}`;
  return await redis.get<string>(key);
}

/**
 * Get leaderboard for a location
 */
export async function getLocationLeaderboard(
  superchargerId: string,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  const locationKey = `${CACHE_KEYS.LOCATION_CHECKINS}${superchargerId}`;
  const vipUserId = await getVIPUser(superchargerId);

  // Get top users with their check-in counts
  const results = await redis.zrange(locationKey, 0, limit - 1, {
    rev: true,
    withScores: true,
  });

  const entries: LeaderboardEntry[] = [];

  if (results) {
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i] as string;
      const count = parseInt(results[i + 1] as string);

      entries.push({
        userId,
        email: "", // Would need to fetch from user data
        checkInCount: count,
        isVIP: userId === vipUserId,
        rank: entries.length + 1,
      });
    }
  }

  return entries;
}

/**
 * Get global leaderboard
 */
export async function getGlobalLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
  const globalKey = CACHE_KEYS.LEADERBOARD_GLOBAL;

  // Get top users across all locations
  const results = await redis.zrange(globalKey, 0, limit - 1, {
    rev: true,
    withScores: true,
  });

  const entries: LeaderboardEntry[] = [];

  if (results) {
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i] as string;
      const count = parseInt(results[i + 1] as string);

      entries.push({
        userId,
        email: "",
        checkInCount: count,
        isVIP: false,
        rank: entries.length + 1,
      });
    }
  }

  return entries;
}

/**
 * Get user statistics
 */
export async function getUserStats(userId: string): Promise<UserStats | null> {
  const statsKey = `${CACHE_KEYS.USER_STATS}${userId}`;
  const totalKey = `${statsKey}:total`;

  const total = await redis.get<number>(totalKey);
  if (total === null) return null;

  const vipLocations = await redis.smembers<string[]>(
    `${CACHE_KEYS.USER_VIP_LOCATIONS}${userId}`
  );

  return {
    userId,
    email: "", // Would need to fetch from user data
    totalCheckIns: total,
    vipLocations: vipLocations || [],
    vipCount: vipLocations?.length || 0,
  };
}

/**
 * Get VIP locations for a user
 */
export async function getUserVIPLocations(userId: string): Promise<string[]> {
  const key = `${CACHE_KEYS.USER_VIP_LOCATIONS}${userId}`;
  const locations = await redis.smembers<string[]>(key);
  return locations || [];
}

/**
 * Delete check-in data (for cleanup/testing)
 */
export async function deleteCheckInData(userId?: string, superchargerId?: string): Promise<void> {
  if (userId && superchargerId) {
    // Delete specific check-in
    const key = `${CACHE_KEYS.CHECKIN}${userId}:${superchargerId}`;
    await redis.del(key);
  } else if (userId) {
    // Delete all check-ins for user
    const pattern = `${CACHE_KEYS.CHECKIN}${userId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}
