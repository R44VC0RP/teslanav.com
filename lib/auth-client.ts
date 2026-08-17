"use client";

import { autumnClient } from "autumn-js/better-auth/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [autumnClient()],
});
