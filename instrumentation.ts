export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ getMigrations }, { auth }] = await Promise.all([
    import("better-auth/db/migration"),
    import("@/lib/auth"),
  ]);
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
