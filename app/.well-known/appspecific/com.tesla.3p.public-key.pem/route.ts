import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const publicKey = process.env.TESLA_PUBLIC_KEY_FILE
    ? await readFile(process.env.TESLA_PUBLIC_KEY_FILE, "utf8").catch(() => null)
    : process.env.TESLA_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  if (!publicKey) {
    return new NextResponse("Tesla public key is not configured", { status: 503 });
  }
  return new NextResponse(publicKey, {
    headers: {
      "Content-Type": "application/x-pem-file",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
