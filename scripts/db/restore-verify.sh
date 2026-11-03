#!/usr/bin/env bash
# Перевірка, що backup відновлюється: розгортає дамп у ОКРЕМУ тестову БД і порівнює відбиток даних зі знятим при backup.
# Використання: RESTORE_DATABASE_URL='postgresql://...тестова...' scripts/db/restore-verify.sh <каталог backup>
# ЗАХИСТ: відмовляється працювати з хостами supabase.co / supabase.com (production і будь-які хмарні проєкти).
set -euo pipefail
: "${RESTORE_DATABASE_URL:?потрібна змінна RESTORE_DATABASE_URL (тестова БД)}"
DIR="${1:?вкажіть каталог backup}"
HERE="$(cd "$(dirname "$0")" && pwd)"
case "$RESTORE_DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*) echo "ВІДМОВА: відновлення у хмарний Supabase-проєкт заборонено цим скриптом." >&2; exit 2;;
esac
( cd "$DIR" && sha256sum -c SHA256SUMS >/dev/null ) || { echo "ВІДМОВА: контрольні суми backup не збігаються." >&2; exit 3; }
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$DIR/bonsi.dump" 2> "$DIR/restore.log" || true
psql "$RESTORE_DATABASE_URL" -X -q -f "$HERE/fingerprint.sql" > "$DIR/fingerprint.restored.txt"
if diff -u "$DIR/fingerprint.txt" "$DIR/fingerprint.restored.txt" > "$DIR/fingerprint.diff"; then
  echo "OK: відбиток відновленої БД збігається з backup ($(wc -l < "$DIR/fingerprint.txt") перевірок)."
else
  echo "ПОМИЛКА: відбитки відрізняються, див. $DIR/fingerprint.diff" >&2; exit 1
fi
