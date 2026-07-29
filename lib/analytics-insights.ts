/**
 * Pure helpers that turn data we already store (referrer hostnames and IANA
 * timezones) into acquisition insight. No new collection, no external
 * services, client-safe.
 */

const CHANNEL_RULES: Array<{ channel: string; pattern: RegExp }> = [
  {
    channel: "Search",
    pattern:
      /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|startpage|qwant|baidu|yandex)\.[a-z.]+$|^search\.|googlequicksearchbox|^com\.google\./,
  },
  { channel: "Reddit", pattern: /(^|\.)(reddit\.com|redd\.it)$/ },
  { channel: "X / Twitter", pattern: /(^|\.)(twitter\.com|x\.com|t\.co)$/ },
  { channel: "YouTube", pattern: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { channel: "Facebook", pattern: /(^|\.)(facebook\.com|fb\.com)$/ },
  { channel: "Instagram", pattern: /(^|\.)instagram\.com$/ },
  { channel: "TikTok", pattern: /(^|\.)tiktok\.com$/ },
  {
    channel: "Discord / Telegram",
    pattern: /(^|\.)(discord\.com|discordapp\.com|discord\.gg|t\.me|telegram\.org)$/,
  },
  { channel: "Hacker News", pattern: /(^|\.)ycombinator\.com$/ },
  { channel: "GitHub", pattern: /(^|\.)github\.com$/ },
  {
    channel: "Tesla forums",
    pattern: /(^|\.)(teslamotorsclub\.com|teslaownersonline\.com|tff-forum\.de)$/,
  },
  {
    channel: "Other social",
    pattern: /(^|\.)(linkedin\.com|threads\.net|bsky\.app|mastodon\.[a-z.]+)$/,
  },
];

export function classifyReferrerHost(host: string | null | undefined): string {
  if (!host) return "Direct";
  const normalized = host.toLowerCase().replace(/^www\./, "");
  for (const rule of CHANNEL_RULES) {
    if (rule.pattern.test(normalized)) return rule.channel;
  }
  return "Other";
}

// IANA timezone → ISO 3166 country for the zones we realistically see.
// Coarse by design: a timezone is the only location signal analytics stores.
const TIMEZONE_COUNTRIES: Record<string, string> = {
  // United States
  "America/New_York": "US", "America/Detroit": "US", "America/Chicago": "US",
  "America/Denver": "US", "America/Boise": "US", "America/Phoenix": "US",
  "America/Los_Angeles": "US", "America/Anchorage": "US", "America/Juneau": "US",
  "America/Sitka": "US", "America/Nome": "US", "America/Adak": "US",
  "America/Menominee": "US", "America/Yakutat": "US", "America/Metlakatla": "US",
  "Pacific/Honolulu": "US", "US/Eastern": "US", "US/Central": "US",
  "US/Mountain": "US", "US/Pacific": "US",
  // Canada
  "America/Toronto": "CA", "America/Montreal": "CA", "America/Vancouver": "CA",
  "America/Edmonton": "CA", "America/Winnipeg": "CA", "America/Regina": "CA",
  "America/Halifax": "CA", "America/St_Johns": "CA", "America/Moncton": "CA",
  "America/Whitehorse": "CA", "America/Yellowknife": "CA", "America/Iqaluit": "CA",
  // Mexico, Central & South America
  "America/Mexico_City": "MX", "America/Monterrey": "MX", "America/Tijuana": "MX",
  "America/Cancun": "MX", "America/Guatemala": "GT", "America/Costa_Rica": "CR",
  "America/Panama": "PA", "America/Bogota": "CO", "America/Lima": "PE",
  "America/Caracas": "VE", "America/Santiago": "CL", "America/Sao_Paulo": "BR",
  "America/Fortaleza": "BR", "America/Bahia": "BR", "America/Manaus": "BR",
  "America/Recife": "BR", "America/Montevideo": "UY", "America/Asuncion": "PY",
  "America/La_Paz": "BO", "America/Guayaquil": "EC", "America/Puerto_Rico": "PR",
  "America/Santo_Domingo": "DO", "America/Jamaica": "JM", "America/Havana": "CU",
  // Europe
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR",
  "Europe/Berlin": "DE", "Europe/Amsterdam": "NL", "Europe/Brussels": "BE",
  "Europe/Luxembourg": "LU", "Europe/Madrid": "ES", "Europe/Lisbon": "PT",
  "Europe/Rome": "IT", "Europe/Zurich": "CH", "Europe/Vienna": "AT",
  "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI", "Europe/Warsaw": "PL", "Europe/Prague": "CZ",
  "Europe/Bratislava": "SK", "Europe/Budapest": "HU", "Europe/Bucharest": "RO",
  "Europe/Sofia": "BG", "Europe/Athens": "GR", "Europe/Belgrade": "RS",
  "Europe/Zagreb": "HR", "Europe/Ljubljana": "SI", "Europe/Vilnius": "LT",
  "Europe/Riga": "LV", "Europe/Tallinn": "EE", "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA", "Europe/Istanbul": "TR", "Europe/Moscow": "RU",
  "Europe/Minsk": "BY", "Atlantic/Reykjavik": "IS", "Europe/Malta": "MT",
  // Middle East & Africa
  "Asia/Jerusalem": "IL", "Asia/Dubai": "AE", "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Amman": "JO",
  "Asia/Beirut": "LB", "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Africa/Casablanca": "MA",
  "Africa/Algiers": "DZ", "Africa/Tunis": "TN", "Africa/Accra": "GH",
  // Asia & Oceania
  "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK", "Asia/Taipei": "TW", "Asia/Singapore": "SG",
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD", "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN", "Asia/Manila": "PH", "Asia/Jakarta": "ID",
  "Asia/Kuala_Lumpur": "MY", "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU", "Australia/Perth": "AU", "Australia/Adelaide": "AU",
  "Australia/Hobart": "AU", "Pacific/Auckland": "NZ",
};

const TIMEZONE_PREFIX_COUNTRIES: Array<{ prefix: string; country: string }> = [
  { prefix: "America/Indiana/", country: "US" },
  { prefix: "America/Kentucky/", country: "US" },
  { prefix: "America/North_Dakota/", country: "US" },
  { prefix: "America/Argentina/", country: "AR" },
  { prefix: "Australia/", country: "AU" },
];

const REGION_FALLBACKS: Array<{ prefix: string; region: string }> = [
  { prefix: "America/", region: "Americas" },
  { prefix: "Europe/", region: "Europe" },
  { prefix: "Asia/", region: "Asia" },
  { prefix: "Africa/", region: "Africa" },
  { prefix: "Pacific/", region: "Oceania" },
  { prefix: "Atlantic/", region: "Europe" },
  { prefix: "Indian/", region: "Asia" },
];

/**
 * Returns an ISO 3166 alpha-2 code for known zones, a coarse region name for
 * unknown zones, or "Unknown" when no timezone was reported.
 */
export function timezoneToCountry(timezone: string | null | undefined): string {
  if (!timezone) return "Unknown";
  const direct = TIMEZONE_COUNTRIES[timezone];
  if (direct) return direct;
  for (const { prefix, country } of TIMEZONE_PREFIX_COUNTRIES) {
    if (timezone.startsWith(prefix)) return country;
  }
  for (const { prefix, region } of REGION_FALLBACKS) {
    if (timezone.startsWith(prefix)) return region;
  }
  return "Unknown";
}
