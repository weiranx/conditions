export type ProviderModels = Record<string, { primary: string; fast: string }>;
// A refresh may update saved values, but it must not overwrite an unsaved edit.
export function mergeModelDrafts<T extends ProviderModels>(
  current: T,
  previous: T | null,
  next: T,
): T {
  return Object.fromEntries(
    Object.entries(next).map(([provider, models]) => [
      provider,
      {
        primary:
          !previous || current[provider].primary === previous[provider].primary
            ? models.primary
            : current[provider].primary,
        fast:
          !previous || current[provider].fast === previous[provider].fast
            ? models.fast
            : current[provider].fast,
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
