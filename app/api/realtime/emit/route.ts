import { NextRequest, NextResponse } from "next/server";
import { realtime } from "@/lib/realtime";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, data, channel: channelName } = body;

    if (!event || !data) {
      return NextResponse.json({ error: "Missing event or data" }, { status: 400 });
    }

    // Emit to the specified channel (default: live-map)
    const channel = realtime.channel(channelName || "live-map");
    await channel.emit(event, data);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to emit realtime event:", error);
    return NextResponse.json({ error: "Failed to emit event" }, { status: 500 });
  }
}

