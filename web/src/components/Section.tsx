import type { ReactNode } from "react";

/** 章节壳：无大标题（按需求移除），仅保留右上角小索引 + 幽灵编号 */
export default function Section({ id, index, children }: {
  id: string; index: string; children: ReactNode;
}) {
  return (
    <section id={id} className="chapter" tabIndex={-1} aria-label={`第${index}章`}>
      <span className="ghost" aria-hidden="true">{index}</span>
      <span className="ch-corner mono" aria-hidden="true">{index} /</span>
      <div className="ch-body">{children}</div>
    </section>
  );
}
