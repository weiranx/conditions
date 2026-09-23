import { Compass, Footprints, Hand, Mountain, MountainSnow, Snowflake, Timer, type LucideIcon } from "lucide-react";

/** One icon per activity profile, shared by the plan form and preferences. */
export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  hiking: Footprints,
  scrambling: Hand,
  "alpine-climbing": Mountain,
  "snow-climbing": MountainSnow,
  "ski-touring": Snowflake,
  "trail-running": Timer,
  backcountry: Compass,
};
