import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.OPENWEB_NINJA_API_KEY;

  return NextResponse.json({
    apiKeySet: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiKeyFirstChars: apiKey ? apiKey.substring(0, 4) + "..." : "NOT SET",
    allEnvVars: Object.keys(process.env)
      .filter(k => k.includes("OPENWEB") || k.includes("NINJA") || k.includes("API"))
      .reduce((acc, key) => {
        acc[key] = process.env[key]?.substring(0, 4) + "...";
        return acc;
      }, {} as Record<string, string>),
  });
}
