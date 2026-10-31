#!/usr/bin/env python3
"""Підлаштовує згенерований `supabase init` config.toml під CI: без відкритої реєстрації, з TOTP MFA,
без зайвих сервісів (швидший старт). Нічого не додає, якщо секції в цій версії CLI немає."""
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()


def set_in_section(text: str, section: str, key: str, value: str) -> str:
    pattern = re.compile(rf"(^\[{re.escape(section)}\]\s*$)(.*?)(?=^\[|\Z)", re.M | re.S)
    match = pattern.search(text)
    if not match:
        print(f"skip: [{section}] відсутня", file=sys.stderr)
        return text
    body = match.group(2)
    key_re = re.compile(rf"^{re.escape(key)}\s*=.*$", re.M)
    if key_re.search(body):
        body = key_re.sub(f"{key} = {value}", body, count=1)
    else:
        body = f"\n{key} = {value}" + body
    return text[: match.start(2)] + body + text[match.end(2) :]


for section in ["studio", "inbucket", "mailpit", "realtime", "storage", "edge_runtime", "analytics", "db.pooler"]:
    text = set_in_section(text, section, "enabled", "false")

text = set_in_section(text, "auth", "enable_signup", "false")
text = set_in_section(text, "auth", "site_url", '"http://localhost:3100"')
text = set_in_section(text, "auth.mfa.totp", "enroll_enabled", "true")
text = set_in_section(text, "auth.mfa.totp", "verify_enabled", "true")

open(path, "w", encoding="utf-8").write(text)
