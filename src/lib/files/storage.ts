import "server-only";
import { randomUUID } from "node:crypto";

/** Шлях у приватному бакеті: `<project>/<uuid>`; ім'я користувача в шлях не потрапляє. */
export function storagePath(projectId: string): string {
  return `${projectId}/${randomUUID()}`;
}
