import type { ReactNode } from "react";

/**
 * Безпечний показ тексту документа: підтримує лише заголовки (#, ##), списки (- ) і абзаци; жодного HTML із тексту.
 * Те, що бачить клієнт, збігається з тим, від чого рахується SHA-256 версії.
 */
export function DocumentBody({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="ml-5 list-disc space-y-1">
          {list.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length} className="mt-4 text-lg font-semibold">{line.slice(3)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={blocks.length} className="text-xl font-semibold">{line.slice(2)}</h2>);
    else blocks.push(<p key={blocks.length} className="whitespace-pre-wrap break-words">{line}</p>);
  }
  flush();
  return <div className="flex flex-col gap-3 leading-relaxed">{blocks}</div>;
}
