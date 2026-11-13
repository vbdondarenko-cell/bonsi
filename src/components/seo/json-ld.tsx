type JsonLdValue = Record<string, unknown> | Record<string, unknown>[];

/**
 * JSON-LD у <script>. Екрануємо `<`, щоб дані з БД (назви кейсів, тексти)
 * не могли закрити тег і вставити розмітку на сторінку.
 */
export function JsonLd({ data }: { data: JsonLdValue }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
