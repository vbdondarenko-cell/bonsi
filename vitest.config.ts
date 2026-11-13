import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The Next.js tsconfig preserves JSX for SWC; Vitest's OXC transform needs an explicit JSX runtime.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      "server-only": fromRoot("./src/test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Інтеграційні тести SQL скидають схему public: файли з базою виконуються по черзі.
    fileParallelism: false,
  },
});
