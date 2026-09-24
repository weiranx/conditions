import { lazy, Suspense } from "react";
import type { StreamdownProps } from "streamdown";
import { loadStreamdown } from "./markdown-loader";

const Streamdown = lazy(() =>
  loadStreamdown().then((m) => ({ default: m.Streamdown })),
);

export function Markdown({
  children,
  mode,
}: {
  children: string;
  mode?: StreamdownProps["mode"];
}) {
  return (
    <Suspense fallback={<p className="field-markdown-plain">{children}</p>}>
      <Streamdown mode={mode}>{children}</Streamdown>
    </Suspense>
  );
}
