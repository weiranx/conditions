import { Backpack, Compass, Footprints, Hand, Mountain, MountainSnow, Pickaxe, Snowflake, Timer, type LucideIcon } from "lucide-react";

/** One icon per activity profile, shared by the plan form and preferences. */
export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  hiking: Footprints,
  backpacking: Backpack,
  scrambling: Hand,
  "alpine-climbing": Mountain,
  mountaineering: Pickaxe,
  "snow-climbing": MountainSnow,
  "ski-touring": Snowflake,
  "trail-running": Timer,
  backcountry: Compass,
};
