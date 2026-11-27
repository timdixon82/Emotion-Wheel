"""command_gate.py: decide which pre-approved Bash actions a command may use.

Called by pre-tool-use.sh with the command in the environment variable
_HOOK_ACTION, the project directory in _HOOK_PROJECT and the directory the
command runs in (the hook input's cwd) in _HOOK_CWD. Prints one line:

  refuse            no allow decision (the normal permission prompt runs)
  ok 0 3 5          the command is one simple command and matches the
                    anchored pattern for each listed key (0 to 5)

Anything unexpected prints "refuse". Spec: work folder 062, Fix 1 and Fix 2.
"""
import os
import re
import shlex
import string
import subprocess
import sys

BAD_NORMAL = set(";&|<>(){}\\$`!#*?[]~\n\r\0")
HEREDOC = re.compile(
    r"\"\$\(cat <<'([A-Za-z_][A-Za-z0-9_]*)'\n(.*?)\n\1\n\)\"", re.S)
MSG_CONTEXT = re.compile(
    r"(?:git commit|gh (?:pr|issue) (?:create|comment|edit))(?: .*)? (?:-m|--message|-b|--body) $")

# Per command: options that take no value, and options whose value is skipped.
# The heredoc is collapsed only when everything between the subcommand and the
# message flag is one of these (round 4: -a is valueless for git, not for gh).
GIT_COMMIT = ({"-a", "-s", "-S", "-n", "-v", "-q", "-e", "--amend", "--no-verify",
               "--signoff", "--all", "--quiet", "--verbose", "--no-edit"}, set())
GH_CREATE = ({"--draft", "-d"}, {"--title", "-t"})
MSG_FLAGS = {"-m", "--message", "-b", "--body"}
BODY_OK = frozenset(string.ascii_letters + string.digits + " \n.,:;-_/!?=")


def msg_position(prev):
    """True if the heredoc word would be the value of a message option."""
    if not MSG_CONTEXT.match(prev) or " -- " in prev:
        return False
    try:
        toks = shlex.split(prev)
    except ValueError:
        return False
    if toks[:2] == ["git", "commit"]:
        valueless, valued = GIT_COMMIT
        k = 2
    elif toks[:1] == ["gh"] and len(toks) > 3:
        valueless, valued = GH_CREATE
        k = 3
    else:
        return False
    end = len(toks) - 1  # the final token is the message flag
    while k < end:
        if toks[k] in valueless:
            k += 1
        elif toks[k] in valued and k + 1 < end:
            k += 2
        else:
            return False
    return toks[end] in MSG_FLAGS


def walk(cmd):
    """Return the normalised single-line command, or None to refuse."""
    out = []
    i, n = 0, len(cmd)
    state = "n"
    collapsed = False
    while i < n:
        c = cmd[i]
        if state == "n":
            if c == '"' and not collapsed:
                m = HEREDOC.match(cmd, i)
                # Collapse only a body made of allow-listed characters (letters, digits,
                # space, newline and . , : ; - _ / ! ? =: bash 3.2 ends the $( ) at the
                # first ")", findings F4, B2, round 4) and only as the value
                # right after -m, --message, -b or --body of git commit or gh create,
                # comment or edit (finding B1: anywhere else the body becomes an option).
                prev = "".join(out)
                if (m and m.group(1) not in m.group(2).split("\n")
                        and set(m.group(2)) <= BODY_OK
                        and msg_position(prev)):
                    out.append('"MSG"')
                    i = m.end()
                    collapsed = True
                    continue
            if c in BAD_NORMAL:
                return None
            if c == "'":
                state = "s"
            elif c == '"':
                state = "d"
            out.append(c)
        elif state == "s":
            if c == "'":
                state = "n"
            out.append(" " if c in "\n\r" else c)
        else:
            if c in "$`\0":
                return None
            if c == "\\":
                if i + 1 < n and cmd[i + 1] in '"\\':
                    out.append(cmd[i:i + 2])
                    i += 2
                    continue
                return None
            if c == '"':
                state = "n"
            out.append(" " if c in "\n\r" else c)
        i += 1
    if state != "n":
        return None
    return "".join(out)


SENSITIVE = re.compile(
    r"secret|credential|passw|token|id_rsa|id_ed25519|\.pem$|\.key$|\.p12$")
BRANCH_NAME = re.compile(r"[A-Za-z0-9._/][A-Za-z0-9._/-]*")
PROTECTED = ("main", "master")


def file_ok(val):
    """True only for stdin. Every other file option prompts: nothing is resolved.

    shortcut: no project-file allowance, relax with a strict resolver if prompts annoy.
    """
    return val == "-"


def scan(tokens, short, other, longs):
    """Yield (kind, value) for the options of interest in a token list.

    short maps a short option letter to a kind, other is the set of short
    letters that take a value we do not care about, longs(name) gives a kind
    or None. An attached or following value is returned ("" if missing).
    """
    k = 0
    while k < len(tokens):
        t = tokens[k]
        k += 1
        if t == "--":
            break
        if t.startswith("--"):
            name, eq, val = t[2:].partition("=")
            kind = longs(name)
            if kind:
                if not eq:
                    val = tokens[k] if k < len(tokens) else ""
                    k += 1
                yield kind, val
        elif t.startswith("-") and len(t) > 1:
            for i, ch in enumerate(t[1:], 1):
                if ch in short:
                    val = t[i + 1:]
                    if not val:
                        val = tokens[k] if k < len(tokens) else ""
                        k += 1
                    yield short[ch], val
                    break
                if ch in other:
                    break


def commit_ok(args):
    """git commit: file options (-F, -t, --file, --template ...) read stdin or a project file."""
    def longs(name):
        if name and ("file".startswith(name) or "template".startswith(name)):
            return "file"
        if len(name) > 1 and "pathspec-from-file".startswith(name):
            return "file"
        return None
    return all(file_ok(v)
               for _, v in scan(args, {"F": "file", "t": "file"}, set("mCcSu"), longs))


URLISH = re.compile(r"(?i)[a-z][a-z0-9+.-]*://|git@|[\w-]+(\.[\w-]+)+(:\d+)?/|[^/\s]*@")
_LONGS = {"body-file": "file", "template": "file", "repo": "repo", "head": "head"}


def origin_slug(project):
    """owner/repo of this project's origin remote on github.com, lower case, or None."""
    try:
        r = subprocess.run(["git", "remote", "get-url", "origin"], cwd=project or None,
                           capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    return slug_of(r.stdout.strip()) if r.returncode == 0 else None


def slug_of(text):
    m = re.search(r"github\.com[:/]+([^/\s:]+)/([^/\s#?]+)", text)
    if not m:
        m = re.fullmatch(r"([^/\s:]+)/([^/\s#?]+)", text)
    if not m:
        return None
    repo = m.group(2)
    repo = repo[:-4] if repo.endswith(".git") else repo
    return (m.group(1) + "/" + repo).lower()


def gh_ok(args, project):
    """gh pr/issue create/comment: body and template files from stdin only; a
    repository only as the exact lower-case OWNER/REPO of this project's origin;
    any URL, host or git@ argument prompts."""
    origin = origin_slug(project)
    for kind, v in scan(args, {"F": "file", "T": "file", "R": "repo", "H": "head"},
                        set("aBblmprt"), _LONGS.get):
        if kind == "file" and not file_ok(v):
            return False
        if kind == "repo" and (origin is None or v != origin):
            return False
        if kind == "head" and ":" in v and (
                origin is None or v.split(":")[0].lower() != origin.split("/")[0]):
            return False
    for t in args:
        if URLISH.match(t):
            return False
    return True


def branch_ok(rest):
    """git branch NAME [START], checkout -b, switch -c: plain names, never main or master."""
    if rest[:1] == ["branch"]:
        args = rest[1:]
    elif rest[:2] in (["checkout", "-b"], ["switch", "-c"]):
        args = rest[2:]
    else:
        return False
    if not 1 <= len(args) <= 2 or not all(BRANCH_NAME.fullmatch(a) for a in args):
        return False
    return strip_heads(args[0].lower()) not in PROTECTED


def strip_heads(name):
    for pre in ("refs/heads/", "heads/"):
        if name.startswith(pre):
            return name[len(pre):]
    return name


def current_branch(directory):
    if not directory:
        return None
    try:
        r = subprocess.run(["git", "symbolic-ref", "-q", "--short", "HEAD"],
                           cwd=directory, capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    b = r.stdout.strip()
    return b if r.returncode == 0 and b else None


def push_allowed(toks, directory):
    opts_ok = {"-u", "--set-upstream", "-n", "--dry-run", "-q", "--quiet",
               "-v", "--verbose", "--no-verify"}
    k = 0
    while k < len(toks) and toks[k].startswith("-"):
        if toks[k] not in opts_ok:
            return False
        k += 1
    if k >= len(toks) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9._-]*", toks[k]):
        return False
    refspecs = toks[k + 1:]
    if not refspecs:
        return False
    for r in refspecs:
        if r.startswith("-") or r.startswith("+"):
            return False
        if not re.fullmatch(r"[A-Za-z0-9._/@:-]+", r) or r.count(":") > 1:
            return False
        if ":" in r:
            src, dst = r.split(":")
            if not src or not dst:
                return False
            if src.startswith("refs/") or src.startswith("heads/"):
                return False
        else:
            src = dst = r
        if dst in ("HEAD", "@"):
            # Resolved where the command runs (the hook input's cwd, or -C).
            dst = current_branch(directory)
            if dst is None:
                return False
        dst = strip_heads(dst.lower())
        if dst in PROTECTED or dst.startswith("refs/") or dst == "head":
            return False
    return True


def git_parts(tokens, cwd):
    """For 'git [-C path] ...' return (args after git, directory it runs in), else None."""
    if tokens[:1] != ["git"]:
        return None
    rest, directory = tokens[1:], cwd or None
    if rest[:1] == ["-C"]:
        p = rest[1] if len(rest) > 2 else ""
        if not p or p.startswith("-") or ".." in p.split("/"):
            return None
        if p.startswith("/"):
            directory = p
        elif cwd:
            directory = os.path.join(cwd, p)
        else:
            return None  # relative path and no cwd: cannot resolve
        rest = rest[2:]
    return rest, directory


GH = {("pr", "create"): 3, ("pr", "comment"): 4, ("issue", "comment"): 4, ("issue", "create"): 5}


def main():
    cmd = os.environ.get("_HOOK_ACTION", "")
    project = os.environ.get("_HOOK_PROJECT", "")
    cwd = os.environ.get("_HOOK_CWD", "")
    norm = walk(cmd)
    if norm is None:
        print("refuse")
        return
    tokens = shlex.split(norm)
    ok = []
    if tokens[:1] in (["git"], ["gh"]) and any(re.match(r"-[A-Za-z]+=", t) for t in tokens):
        print("refuse")  # a short option with an attached '=' value: not parsed, prompt
        return
    g = git_parts(tokens, cwd)
    if g:
        rest, directory = g
        if branch_ok(rest):
            ok.append(0)
        if rest[:1] == ["commit"] and tokens[1:2] != ["-C"] and commit_ok(rest[1:]):
            ok.append(1)
        if rest[:1] == ["push"] and push_allowed(rest[1:], directory):
            ok.append(2)
    elif tokens[:1] == ["gh"] and tuple(tokens[1:3]) in GH:
        if gh_ok(tokens[3:], project):
            ok.append(GH[tuple(tokens[1:3])])
    print("ok " + " ".join(map(str, ok)) if ok else "refuse")


try:
    main()
except Exception:
    print("refuse")
    sys.exit(0)
