#!/usr/bin/env bash
# Повний логічний backup BONSI (схеми public і auth) + відбиток даних + контрольні суми. Лише читання з джерела.
# Використання: SOURCE_DATABASE_URL='postgresql://...' scripts/db/backup.sh [каталог]
# Рядок підключення береться зі змінної середовища і ніколи не друкується.
set -euo pipefail
: "${SOURCE_DATABASE_URL:?потрібна змінна SOURCE_DATABASE_URL}"
OUT="${1:-backup-$(date -u +%Y%m%dT%H%M%SZ)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --schema=public --schema=auth --file="$OUT/bonsi.dump"
pg_dump "$SOURCE_DATABASE_URL" --schema-only --no-owner --no-acl --schema=public --file="$OUT/schema-public.sql"
psql "$SOURCE_DATABASE_URL" -X -q -f "$HERE/fingerprint.sql" > "$OUT/fingerprint.txt"
( cd "$OUT" && sha256sum bonsi.dump schema-public.sql fingerprint.txt > SHA256SUMS )
echo "Backup записано у $OUT ($(wc -l < "$OUT/fingerprint.txt") рядків відбитка)."
