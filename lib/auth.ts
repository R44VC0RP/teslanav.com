import { autumn } from "autumn-js/better-auth";
import { betterAuth } from "better-auth";
import { database } from "@/lib/database";

const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;

export const auth = betterAuth({
  appName: "TeslaNav",
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  trustedOrigins: [
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "https://teslanav.com",
  ],
  plugins: autumnSecretKey
    ? [
        autumn({
          secretKey: autumnSecretKey,
          customerScope: "user",
        }),
      ]
    : [],
});

export type AuthSession = typeof auth.$Infer.Session;
