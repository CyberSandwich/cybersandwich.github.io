#!/usr/bin/env zsh
# clean-links.sh — Lint and normalize links.json
#
# Ensures:
#   1. Categories ordered to match app.js linkCategories
#   2. Links sorted alphabetically (case-insensitive) within each category
#   3. Trailing slashes stripped from URL paths (not roots, not fragments/queries)
#   4. Valid JSON output
#
# Usage:
#   ./scripts/clean-links.sh              Apply fixes
#   ./scripts/clean-links.sh -n           Dry-run (show what would change)
#   ./scripts/clean-links.sh --check      Exit 1 if any changes needed (for CI)

set -euo pipefail
cd "${0:A:h}/.."

# ── Formatting ──────────────────────────────────────────────────────
B='\033[1m' G='\033[32m' Y='\033[33m' R='\033[31m' C='\033[36m' D='\033[2m' Z='\033[0m'
ok()   { printf "${G}[ok]${Z}    %b\n" "$*"; }
warn() { printf "${Y}[warn]${Z}  %b\n" "$*"; }
err()  { printf "${R}[err]${Z}   %b\n" "$*" >&2; }
info() { printf "${C}[info]${Z}  %b\n" "$*"; }
dim()  { printf "${D}%s${Z}\n" "$*"; }

JSON="links/links.json"
APP_JS="app.js"
MODE="apply"

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) MODE="dry" ;;
    --check)      MODE="check" ;;
    --help|-h)
      printf "${B}clean-links.sh${Z} — Lint and normalize links.json\n\n"
      printf "Usage:\n"
      printf "  ${C}./scripts/clean-links.sh${Z}          Apply fixes\n"
      printf "  ${C}./scripts/clean-links.sh -n${Z}       Dry-run (show what would change)\n"
      printf "  ${C}./scripts/clean-links.sh --check${Z}  Exit 1 if changes needed (CI)\n"
      exit 0 ;;
    *) err "Unknown argument: $arg"; exit 1 ;;
  esac
done

[[ "$MODE" == "dry" ]] && info "Dry-run mode — no files will be modified."
[[ "$MODE" == "check" ]] && info "Check mode — will exit 1 if changes needed."

python3 - "$MODE" "$JSON" "$APP_JS" << 'PYEOF'
import json, re, sys, os, tempfile
from urllib.parse import urlparse, urlunparse

mode     = sys.argv[1]
json_path = sys.argv[2]
appjs_path = sys.argv[3]

# ANSI
ERR  = "\033[31m[err]\033[0m  "
WARN = "\033[33m[warn]\033[0m "
INFO = "\033[36m[info]\033[0m "
OK   = "\033[32m[ok]\033[0m   "
BOLD = "\033[1m"
DIM  = "\033[2m"
RST  = "\033[0m"

# ── Load data ──
with open(json_path) as f:
    data = json.load(f)
original = json.dumps(data)

# ── Read category order from app.js ──
with open(appjs_path) as f:
    appjs = f.read()
m = re.search(r"linkCategories=\[([^\]]+)\]", appjs)
if not m:
    print(f"{ERR}Could not read linkCategories from {appjs_path}", file=sys.stderr)
    sys.exit(1)
categories = re.findall(r"'([^']+)'", m.group(1))
cat_order = {c: i for i, c in enumerate(categories)}

issues = []

# ── 1. Normalize URLs ──
for entry in data:
    url = entry['url']
    parsed = urlparse(url)

    # Strip trailing slash from path, but only if:
    # - path has more than just "/" (i.e. not a root URL)
    # - no fragment that starts with / (client-side routes like #/)
    # - no query string that could be path-dependent
    path = parsed.path
    if (len(path) > 1
            and path.endswith('/')
            and not (parsed.fragment and parsed.fragment.startswith('/'))
            and not parsed.query):
        new_path = path.rstrip('/')
        new_url = urlunparse(parsed._replace(path=new_path))
        issues.append(f"  URL trailing slash: {BOLD}{entry['title']}{RST}")
        issues.append(f"    {DIM}{url} → {new_url}{RST}")
        entry['url'] = new_url

# ── 2. Check for unknown categories ──
for entry in data:
    if entry['category'] not in cat_order:
        issues.append(f"  Unknown category: {BOLD}{entry['category']}{RST} on \"{entry['title']}\"")

# ── 3. Sort: categories by app.js order, alphabetical within ──
sorted_data = sorted(data, key=lambda x: (cat_order.get(x['category'], 999), x['title'].lower()))

# Detect sort changes
sort_changes = 0
for i, (a, b) in enumerate(zip(data, sorted_data)):
    if a['title'] != b['title'] or a['category'] != b['category']:
        sort_changes += 1
if sort_changes:
    issues.append(f"  Sort order: {BOLD}{sort_changes}{RST} entries out of place")

data = sorted_data

# ── 4. Check for duplicate URLs ──
seen_urls = {}
for entry in data:
    norm = re.sub(r'^https?://(www\.)?', '', entry['url']).rstrip('/').lower()
    if norm in seen_urls:
        issues.append(f"  Duplicate URL: {BOLD}{entry['title']}{RST} and {BOLD}{seen_urls[norm]}{RST}")
    seen_urls[norm] = entry['title']

# ── 5. Check for duplicate titles within category ──
seen_titles = {}
for entry in data:
    key = (entry['title'].lower(), entry['category'])
    if key in seen_titles:
        issues.append(f"  Duplicate title: {BOLD}{entry['title']}{RST} in {entry['category']}")
    seen_titles[key] = True

# ── 6. Check key order consistency (title, url, icon, category) ──
preferred_order = ['title', 'url', 'icon', 'category']
rekeyed = 0
for i, entry in enumerate(data):
    keys = list(entry.keys())
    ordered = [k for k in preferred_order if k in keys] + [k for k in keys if k not in preferred_order]
    if keys != ordered:
        rekeyed += 1
        data[i] = {k: entry[k] for k in ordered}
if rekeyed:
    issues.append(f"  Key order: {BOLD}{rekeyed}{RST} entries reordered (title → url → icon → category)")

# ── Compare ──
cleaned = json.dumps(data, indent=2) + '\n'
changed = json.dumps(data) != original

if not issues:
    print(f"{OK} links.json is clean — {len(data)} links, {len(categories)} categories")
    sys.exit(0)

# Report
print(f"{INFO}Found {len(issues) // 1} issue(s):")
for line in issues:
    print(line)

new_size = len(cleaned.encode('utf-8'))
old_size = os.path.getsize(json_path)
diff = old_size - new_size
if diff > 0:
    print(f"\n{INFO}File size: {old_size:,} → {new_size:,} bytes ({BOLD}-{diff}{RST} bytes)")
elif diff < 0:
    print(f"\n{INFO}File size: {old_size:,} → {new_size:,} bytes (+{-diff} bytes)")
else:
    print(f"\n{INFO}File size: {old_size:,} bytes (unchanged)")

if mode == "check":
    if changed:
        print(f"\n{ERR}links.json needs cleaning. Run ./scripts/clean-links.sh to fix.")
        sys.exit(1)
    else:
        print(f"\n{OK} No changes needed.")
        sys.exit(0)

if mode == "dry":
    print(f"\n{INFO}Run without -n to apply.")
    sys.exit(0)

# ── Apply (atomic write) ──
json_dir = os.path.dirname(os.path.abspath(json_path))
fd, tmp_path = tempfile.mkstemp(suffix='.json', dir=json_dir)
try:
    with os.fdopen(fd, 'w') as f:
        f.write(cleaned)

    # Validate before replacing
    with open(tmp_path) as f:
        validated = json.load(f)
    if len(validated) != len(data):
        raise ValueError(f"Expected {len(data)} entries, got {len(validated)}")

    os.replace(tmp_path, json_path)
except Exception as e:
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    print(f"{ERR}Failed to write: {e}", file=sys.stderr)
    sys.exit(1)

print(f"\n{OK} Cleaned links.json ({len(data)} links)")
PYEOF
