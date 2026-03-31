#!/usr/bin/env zsh
# add-link.sh — Add a link to links.json, sorted alphabetically within its category
#
# Usage:
#   ./scripts/add-link.sh <title> <url> [category] [icon]
#   ./scripts/add-link.sh --list-categories     Show available categories
#   ./scripts/add-link.sh --list-icons           Show available icon names
#   ./scripts/add-link.sh --search <query>       Search existing links
#   ./scripts/add-link.sh --count                Show link counts by category
#   ./scripts/add-link.sh -n ...                 Dry-run (preview without writing)
#
# Examples:
#   ./scripts/add-link.sh "Google" "https://google.com"
#   ./scripts/add-link.sh "Google" "https://google.com" Personal search
#   ./scripts/add-link.sh -n "Test" "https://test.com" Personal

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
DRY_RUN=false

# ── Read categories and icons from app.js (single source of truth) ──
get_categories() {
  python3 -c "
import re
with open('$APP_JS') as f:
    content = f.read()
m = re.search(r\"linkCategories=\[([^\]]+)\]\", content)
if m:
    for c in re.findall(r\"'([^']+)'\", m.group(1)):
        print(c)
"
}

get_icons() {
  python3 -c "
import re
with open('$APP_JS') as f:
    content = f.read()
chunk = content[content.find('const ICONS='):content.find('const DEFAULT_')]
for k in re.findall(r\"'([a-z-]+)'\s*:\", chunk):
    print(k)
"
}

# ── Parse flags ────────────────────────────────────────────────────
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
    --list-categories)
      printf "${B}Available categories:${Z}\n"
      get_categories | while read -r c; do printf "  %s\n" "$c"; done
      exit 0 ;;
    --list-icons)
      printf "${B}Available icons:${Z}\n"
      get_icons | while read -r ic; do printf "  %s\n" "$ic"; done
      exit 0 ;;
    --count)
      printf "${B}Links by category:${Z}\n"
      python3 -c "
import json
with open('$JSON') as f:
    data = json.load(f)
from collections import Counter
counts = Counter(x['category'] for x in data)
total = len(data)
for cat, n in sorted(counts.items(), key=lambda x: -x[1]):
    print(f'  {cat:<20s} {n}')
print(f'  {\"─\" * 20} ──')
print(f'  {\"Total\":<20s} {total}')
"
      exit 0 ;;
    --search)
      # Next arg is the query — handled after loop
      ;;
    --help|-h)
      printf "${B}add-link.sh${Z} — Add a link to links.json\n\n"
      printf "Usage:\n"
      printf "  ${C}./scripts/add-link.sh${Z} <title> <url> [category] [icon]\n\n"
      printf "Arguments:\n"
      printf "  ${C}title${Z}       Link title (required)\n"
      printf "  ${C}url${Z}         Full URL (required)\n"
      printf "  ${C}category${Z}    Category (default: Personal)\n"
      printf "  ${C}icon${Z}        Icon name from ICONS map (optional)\n\n"
      printf "Flags:\n"
      printf "  ${C}-n, --dry-run${Z}        Preview without writing\n"
      printf "  ${C}--list-categories${Z}    Show available categories\n"
      printf "  ${C}--list-icons${Z}         Show available icon names\n"
      printf "  ${C}--search <query>${Z}     Search existing links by title or URL\n"
      printf "  ${C}--count${Z}              Show link counts by category\n"
      exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# Handle --search (needs access to the next positional arg)
for (( i=1; i<=$#; i++ )); do
  if [[ "${@[$i]}" == "--search" ]]; then
    QUERY="${@[$((i+1))]:-}"
    if [[ -z "$QUERY" ]]; then
      err "Usage: $0 --search <query>"
      exit 1
    fi
    python3 -c "
import json, sys
query = sys.argv[1].lower()
with open('$JSON') as f:
    data = json.load(f)
matches = [x for x in data if query in x['title'].lower() or query in x['url'].lower()]
if not matches:
    print(f'\033[33m[warn]\033[0m  No links matching \"{sys.argv[1]}\"')
    sys.exit(0)
print(f'\033[36m[info]\033[0m  {len(matches)} match(es) for \"{sys.argv[1]}\":')
for m in matches:
    icon = m.get('icon', '')
    icon_str = f' [{icon}]' if icon else ''
    print(f'  \033[1m{m[\"title\"]}\033[0m{icon_str}')
    print(f'  \033[2m{m[\"url\"]}  ({m[\"category\"]})\033[0m')
" "$QUERY"
    exit 0
  fi
done

TITLE="${ARGS[1]:-}"
URL="${ARGS[2]:-}"
CATEGORY="${ARGS[3]:-Personal}"
ICON="${ARGS[4]:-}"

# ── Validate inputs ───────────────────────────────────────────────
if [[ -z "$TITLE" ]] || [[ -z "$URL" ]]; then
  err "Usage: $0 <title> <url> [category] [icon]"
  exit 1
fi

if ! echo "$URL" | grep -qE '^https?://'; then
  err "URL must start with http:// or https://"
  exit 1
fi

if (( ${#TITLE} > 100 )); then
  err "Title must be 100 characters or fewer"
  exit 1
fi

# Validate JSON file exists and is valid
if [[ ! -f "$JSON" ]]; then
  err "Links file not found: $JSON"
  exit 1
fi
python3 -c "import json; json.load(open('$JSON'))" 2>/dev/null || {
  err "Existing $JSON is invalid — fix it before adding links"
  exit 1
}

# Validate category against app.js
VALID_CATS=("${(@f)$(get_categories)}")
if ! (( ${VALID_CATS[(Ie)$CATEGORY]} )); then
  err "Unknown category: ${B}${CATEGORY}${Z}"
  info "Available categories (from app.js linkCategories):"
  for c in "${VALID_CATS[@]}"; do printf "  %s\n" "$c"; done
  exit 1
fi

# Validate icon against app.js ICONS map
if [[ -n "$ICON" ]]; then
  VALID_ICONS=("${(@f)$(get_icons)}")
  if ! (( ${VALID_ICONS[(Ie)$ICON]} )); then
    err "Unknown icon: ${B}${ICON}${Z}"
    info "Available icons (from app.js ICONS):"
    for ic in "${VALID_ICONS[@]}"; do printf "  %s\n" "$ic"; done
    printf "\n"
    info "Add a new icon to the ICONS map in app.js first, then re-run."
    exit 1
  fi
fi

$DRY_RUN && info "Dry-run mode — no files will be modified."

# ── Add link (atomic: write to temp, validate, move) ──────────────
python3 - "$TITLE" "$URL" "$CATEGORY" "$ICON" "$DRY_RUN" "$JSON" "$APP_JS" << 'PYEOF'
import json, re, sys, os, tempfile

title    = sys.argv[1]
url      = sys.argv[2]
category = sys.argv[3]
icon     = sys.argv[4]
dry_run  = sys.argv[5] == "true"
json_path = sys.argv[6]
appjs_path = sys.argv[7]

# ANSI helpers
ERR  = "\033[31m[err]\033[0m  "
INFO = "\033[36m[info]\033[0m "
OK   = "\033[32m[ok]\033[0m   "
BOLD = "\033[1m"
DIM  = "\033[2m"
RST  = "\033[0m"

with open(json_path) as f:
    data = json.load(f)

# ── Normalize URL for duplicate comparison ──
def normalize_url(u):
    u = u.rstrip('/')
    u = re.sub(r'^https?://(www\.)?', '', u)
    return u.lower()

norm_url = normalize_url(url)

# Check for duplicate URLs (normalized)
for entry in data:
    if normalize_url(entry['url']) == norm_url:
        print(f"{ERR} Duplicate URL already exists: '{entry['title']}' → {entry['url']}", file=sys.stderr)
        sys.exit(1)

# Check for duplicate titles within same category
for entry in data:
    if entry['title'].lower() == title.lower() and entry['category'] == category:
        print(f"{ERR} Duplicate title in {category}: '{entry['title']}'", file=sys.stderr)
        sys.exit(1)

# ── Read category order from app.js ──
with open(appjs_path) as f:
    appjs = f.read()
m = re.search(r"linkCategories=\[([^\]]+)\]", appjs)
if m:
    categories = re.findall(r"'([^']+)'", m.group(1))
else:
    print(f"{ERR} Could not read linkCategories from {appjs_path}", file=sys.stderr)
    sys.exit(1)
cat_order = {c: i for i, c in enumerate(categories)}

# Build entry
new_entry = {'title': title, 'url': url}
if icon:
    new_entry['icon'] = icon
new_entry['category'] = category

data.append(new_entry)
data.sort(key=lambda x: (cat_order.get(x['category'], 999), x['title'].lower()))

# Find position of the new entry for display
pos = next(i for i, x in enumerate(data) if x is new_entry)
total = len(data)
cat_count = sum(1 for x in data if x['category'] == category)

def show_neighbours():
    if pos > 0:
        print(f"{DIM}          After:  {data[pos - 1]['title']}{RST}")
    if pos < total - 1:
        print(f"{DIM}          Before: {data[pos + 1]['title']}{RST}")

if dry_run:
    print(f"{INFO} Would add: {BOLD}{title}{RST} → {url}")
    print(f"{INFO} Category: {category}, Icon: {icon or '(default)'}")
    print(f"{INFO} Position: #{pos + 1} of {total} (#{cat_count} in {category})")
    show_neighbours()
    sys.exit(0)

# Atomic write: temp file → validate → rename
json_dir = os.path.dirname(os.path.abspath(json_path))
fd, tmp_path = tempfile.mkstemp(suffix='.json', dir=json_dir)
try:
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    # Validate the written JSON before replacing
    with open(tmp_path) as f:
        validated = json.load(f)
    if len(validated) != total:
        raise ValueError(f"Expected {total} entries, got {len(validated)}")

    os.replace(tmp_path, json_path)
except Exception as e:
    # Clean up temp file on failure
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    print(f"{ERR} Failed to write JSON: {e}", file=sys.stderr)
    sys.exit(1)

print(f"{OK} Added {BOLD}{title}{RST} to {category} ({cat_count} in category, {total} total)")
show_neighbours()
PYEOF
