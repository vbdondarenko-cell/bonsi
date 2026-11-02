"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { adminFieldClass } from "@/components/admin/ui";
import { FILE_CATEGORY_LABELS } from "@/lib/client/labels";
import { ALLOWED_TYPES, MAX_FILES_PER_REQUEST, MAX_FILE_BYTES } from "@/lib/files/policy";

const ACCEPT = Object.keys(ALLOWED_TYPES).map((ext) => `.${ext}`).join(",");

type Result = { saved: Array<{ id: string; name: string }>; failed: Array<{ name: string; reason: string }> };

/** Завантаження файлів у приватне сховище проєкту. Клієнтська перевірка — лише зручність: остаточну виконує сервер і база. */
export function FileUploader({
  projectId,
  categories,
  allowVisibility = false,
  deliverableId,
  onUploaded,
  fixedCategory,
  label = "Додати файли",
}: {
  projectId: string;
  categories: readonly string[];
  allowVisibility?: boolean;
  deliverableId?: string;
  onUploaded?: (files: Array<{ id: string; name: string }>) => void;
  fixedCategory?: string;
  label?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [category, setCategory] = useState(fixedCategory ?? categories[0] ?? "other");
  const [visible, setVisible] = useState(true);

  async function upload() {
    const files = Array.from(input.current?.files ?? []);
    if (files.length === 0) return setMessage({ tone: "error", text: "Оберіть файл." });
    if (files.length > MAX_FILES_PER_REQUEST) return setMessage({ tone: "error", text: `Не більше ${MAX_FILES_PER_REQUEST} файлів за раз.` });
    const big = files.find((file) => file.size > MAX_FILE_BYTES);
    if (big) return setMessage({ tone: "error", text: `«${big.name}» завеликий (максимум 10 МБ).` });

    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("category", category);
    if (allowVisibility) form.append("visible", String(visible));
    if (deliverableId) form.append("deliverableId", deliverableId);

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/files`, { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as Result | { error?: string } | null;
      const result = body && "saved" in body ? body : null;
      if (result && result.saved.length > 0) {
        onUploaded?.(result.saved);
        setMessage({
          tone: result.failed.length ? "error" : "ok",
          text: result.failed.length
            ? `Збережено: ${result.saved.length}. Не прийнято: ${result.failed.map((f) => `${f.name} — ${f.reason}`).join("; ")}`
            : `Збережено файлів: ${result.saved.length}.`,
        });
        if (input.current) input.current.value = "";
        router.refresh();
      } else {
        setMessage({
          tone: "error",
          text: result?.failed.map((f) => `${f.name} — ${f.reason}`).join("; ") || (response.status === 413 ? "Файли завеликі." : "Не вдалося завантажити файли."),
        });
      }
    } catch {
      setMessage({ tone: "error", text: "Немає зʼєднання з сервером. Спробуйте ще раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {fixedCategory ? null : (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Категорія
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={adminFieldClass}>
              {categories.map((id) => (
                <option key={id} value={id}>
                  {FILE_CATEGORY_LABELS[id] ?? id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
          {label}
          <input ref={input} type="file" multiple accept={ACCEPT} className={`${adminFieldClass} file:mr-4 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:py-1.5 file:text-fg`} />
        </label>
        <Button type="button" onClick={upload} disabled={busy}>
          {busy ? "Завантажуємо…" : "Завантажити"}
        </Button>
      </div>
      {allowVisibility ? (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
          Показати клієнту
        </label>
      ) : null}
      <p className="text-xs text-muted">До 10 МБ, до {MAX_FILES_PER_REQUEST} файлів: зображення, PDF, текст, Office, ZIP, Figma.</p>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-danger" : "text-sm text-ok"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
