export const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  done: "Done",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TASK_PRIORITY_LABELS: Record<(typeof TASK_PRIORITIES)[number], string> = { low: "Низький", normal: "Звичайний", high: "Високий", urgent: "Терміново" };

export type ChecklistItem = { text: string; done: boolean };
export type TaskLink = { kind: "github" | "figma" | "preview" | "other"; url: string };

/** Чекліст як текст: рядок `[x] зроблено` або `[ ] ще ні` (без маркера — не зроблено). */
export function parseChecklist(text: string): ChecklistItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^\[( |x|X)\]\s*(.*)$/.exec(line);
      return match ? { done: match[1].toLowerCase() === "x", text: match[2].trim() } : { done: false, text: line };
    })
    .filter((item) => item.text.length > 0)
    .slice(0, 50);
}

export function checklistToText(items: ChecklistItem[]): string {
  return items.map((item) => `[${item.done ? "x" : " "}] ${item.text}`).join("\n");
}

/** Посилання як текст: `github https://…`, `figma https://…`, `preview https://…`; без типу — визначається за доменом. */
export function parseLinks(text: string): { links: TaskLink[]; invalid: string[] } {
  const links: TaskLink[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const parts = raw.split(/\s+/);
    const url = parts.at(-1)!;
    const explicit = parts.length > 1 ? parts[0].toLowerCase() : null;
    if (!/^https:\/\/[^\s<>"]+$/i.test(url) || url.length > 500) {
      invalid.push(raw);
      continue;
    }
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    const kind: TaskLink["kind"] =
      explicit === "github" || explicit === "figma" || explicit === "preview" || explicit === "other"
        ? explicit
        : /(^|\.)github\.com$/.test(host)
          ? "github"
          : /(^|\.)figma\.com$/.test(host)
            ? "figma"
            : "other";
    links.push({ kind, url });
  }
  return { links: links.slice(0, 20), invalid };
}

export function linksToText(links: TaskLink[]): string {
  return links.map((l) => `${l.kind} ${l.url}`).join("\n");
}

export const isOverdue = (deadline: string | null, status: string, today = new Date()) =>
  Boolean(deadline) && status !== "done" && deadline! < today.toISOString().slice(0, 10);
