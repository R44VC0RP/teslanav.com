const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

function parseShutdownFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return !DISABLED_VALUES.has(value.trim().toLowerCase());
}

export const PROJECT_SHUTDOWN_ENABLED = parseShutdownFlag(
  process.env.NEXT_PUBLIC_PROJECT_SHUTDOWN
);

export const PROJECT_SHUTDOWN_MESSAGE =
  "This project has currently been shutdown, the Waze API we use internally has now been blocked. The project is available on Github as open-source, and if you are interested in aquiring the domain name teslanav.com (average of 20k MAU), please email me at ryan@teslanav.com if interested.";
