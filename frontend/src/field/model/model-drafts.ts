export type ProviderModels = Record<string, { primary: string; fast: string }>;
// A refresh may update a saved value, but it must not overwrite an unsaved
// edit: the draft follows the server only while it still shows the value the
// server last reported.
export function mergeDraft(
  current: string,
  previous: string | null | undefined,
  next: string,
): string {
  return previous == null || current === previous ? next : current;
}
export function mergeDraftRecord(
  current: Record<string, string>,
  previous: Record<string, string> | null,
  next: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => [
      key,
      mergeDraft(current[key] ?? "", previous?.[key], value),
    ]),
  );
}
export function mergeModelDrafts<T extends ProviderModels>(
  current: T,
  previous: T | null,
  next: T,
): T {
  return Object.fromEntries(
    Object.entries(next).map(([provider, models]) => [
      provider,
      {
        primary: mergeDraft(
          current[provider].primary,
          previous?.[provider].primary,
          models.primary,
        ),
        fast: mergeDraft(
          current[provider].fast,
          previous?.[provider].fast,
          models.fast,
        ),
      },
    ]),
  ) as T;
}
export function modelOptions(
  catalog: string[],
  configured: string[],
): string[] {
  return [
    ...new Set(
      [...catalog, ...configured].map((value) => value.trim()).filter(Boolean),
    ),
  ];
}
