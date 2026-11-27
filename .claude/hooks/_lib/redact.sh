#!/usr/bin/env bash
# _lib/redact.sh: remove secrets from text before it is written to a log.
#
# Source this file, then pipe text through redact_text (stdin to stdout).
# It fails closed: if python3 is missing or errors, it prints a fixed marker
# and never the raw text. Patterns and order: work folder 062 spec, Fix 4.

redact_text() {
  local out
  out=$(python3 -c '
import re, sys
t = sys.stdin.read()
R = "[REDACTED]"
I = re.I
t = re.sub(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)", R, t)
t = re.sub(r"(\bdigest\s+)[^\r\n\x27]+", lambda m: m.group(1) + R, t, flags=I)
t = re.sub(r"(authorization|proxy-authorization|x-api-key|x-auth-token|x-access-token|x-github-token|private-token|job-token|cookie|set-cookie)([\"\x27]?\s*[:=]\s*[\"\x27]?)(?:(bearer|basic|token|digest|negotiate|ntlm)\s+)?[^\r\n\"\x27]+",
           lambda m: m.group(1) + m.group(2) + ((m.group(3) + " ") if m.group(3) else "") + R, t, flags=I)
t = re.sub(r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}", "Bearer " + R, t, flags=I)
t = re.sub(r"(\w[\w+.-]*://)[^\s\"\x27@/:]*:[^\s\"\x27]*@", lambda m: m.group(1) + R + "@", t)
t = re.sub(r"(\w[\w+.-]*://)[^/@\s\"\x27]+@", lambda m: m.group(1) + R + "@", t)
for p in (r"gh[pousr]_[A-Za-z0-9]{30,}", r"github_pat_[A-Za-z0-9_]{20,}", r"sk-[A-Za-z0-9_-]{20,}",
          r"[sr]k_(?:live|test)_[A-Za-z0-9]{16,}", r"AKIA[0-9A-Z]{16}", r"ASIA[0-9A-Z]{16}",
          r"xox[baprs]-[A-Za-z0-9-]{10,}", r"AIza[0-9A-Za-z_-]{35}", r"npm_[A-Za-z0-9]{30,}",
          r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"):
    t = re.sub(p, R, t)
t = re.sub(r"([A-Za-z0-9_]*(?:token|secret|passw(?:or)?d|passphrase|api_?key|private_?key|access_?key|credential)[A-Za-z0-9_]*)([\"\x27]?\s*[=:]\s*)(\"[^\"]*\"|\x27[^\x27]*\x27|\S+)",
           lambda m: m.group(1) + m.group(2) + R, t, flags=I)
t = re.sub(r"([?&][\w.-]*(?:key|sig|signature|token|secret|passw(?:or)?d|auth|credential)[\w.-]*=)[^&\s\"\x27#]+",
           lambda m: m.group(1) + R, t, flags=I)
t = re.sub(r"(--?(?:[a-z]+-)*(?:password|passwd|pass|token|secret|api-key|apikey|client-secret)(?:=|\s+))(\"[^\"]*\"|\x27[^\x27]*\x27|\S+)",
           lambda m: m.group(1) + R, t, flags=I)
t = re.sub(r"(\bsshpass\b[^\r\n]*?\s-p\s*)\S+", lambda m: m.group(1) + R, t)
t = re.sub(r"(\bmysql\w*\b[^\r\n]*?\s-p)\S+", lambda m: m.group(1) + R, t)
# -u and --user take a password on a curl or wget command (git push -u does not).
# A command may be split over lines with a trailing backslash: join those lines in a
# scan copy to decide, then redact each physical line. Any -u or --user value that
# holds a colon is redacted on every line, curl or not.
U = r"(?<![\w-])(-u|--user)(=|\s*)(?=\S)(\"[^\"]*\"|\x27[^\x27]*\x27|\S+)"
def fix(m, always):
    v = m.group(3)
    return m.group(0) if not always and ":" not in v else m.group(1) + m.group(2) + R
lines = t.split("\n")
out, i = [], 0
while i < len(lines):
    j = i
    while j < len(lines) - 1 and lines[j].endswith("\\"):
        j += 1
    grp = lines[i:j + 1]
    web = re.search(r"\b(curl|wget)\b", " ".join(x.rstrip("\\") for x in grp)) is not None
    out += [re.sub(U, lambda m: fix(m, web), x) for x in grp]
    i = j + 1
t = "\n".join(out)
sys.stdout.write(t)
' 2>/dev/null) || { printf '%s' '[REDACTED: redactor unavailable]'; return 0; }
  printf '%s' "$out"
}
