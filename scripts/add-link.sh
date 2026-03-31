#!/usr/bin/env zsh
# add-link.sh — Add a link to links.json, sorted alphabetically within its category
#
# Usage:
#   ./scripts/add-link.sh <title> <url> [category] [icon]
#   ./scripts/add-link.sh --list-categories     Show available categories
#   ./scripts/add-link.sh --list-icons           Show available icon names
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
DRY_RUN=false

# ── Parse flags ────────────────────────────────────────────────────
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
    --list-categories)
      printf "${B}Available categories:${Z}\n"
      printf "  Personal\n  Initiatives\n  Academic\n  Career\n  Community\n  Social Media\n  Modules\n  Miscellaneous\n"
      exit 0 ;;
    --list-icons)
      printf "${B}Available icons:${Z}\n"
      python3 -c "
import re
with open('app.js') as f:
    content = f.read()
chunk = content[content.find('const ICONS='):content.find('const DEFAULT_')]
for k in re.findall(r\"'([a-z-]+)'\s*:\", chunk):
    print(f'  {k}')
"
      exit 0 ;;
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
      exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

TITLE="${ARGS[1]:-}"
URL="${ARGS[2]:-}"
CATEGORY="${ARGS[3]:-Personal}"
ICON="${ARGS[4]:-}"

# ── Validate ───────────────────────────────────────────────────────
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

$DRY_RUN && info "Dry-run mode — no files will be modified."

# ── Add link ───────────────────────────────────────────────────────
python3 - "$TITLE" "$URL" "$CATEGORY" "$ICON" "$DRY_RUN" << 'PYEOF'
import json, sys

title, url, category, icon, dry_run = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] == "true"

with open('links/links.json') as f:
    data = json.load(f)

# Check for duplicate URLs
for entry in data:
    if entry['url'].rstrip('/') == url.rstrip('/'):
        print(f"\033[31m[err]\033[0m   Duplicate URL already exists: '{entry['title']}' → {entry['url']}", file=sys.stderr)
        sys.exit(1)

# Check for duplicate titles within same category
for entry in data:
    if entry['title'].lower() == title.lower() and entry['category'] == category:
        print(f"\033[31m[err]\033[0m   Duplicate title in {category}: '{entry['title']}'", file=sys.stderr)
        sys.exit(1)

# Build entry
new_entry = {'title': title, 'url': url}
if icon:
    new_entry['icon'] = icon
new_entry['category'] = category

# Find insertion point (alphabetical within category)
categories = ['Personal', 'Social Media', 'Initiatives', 'Academic', 'Career', 'Community', 'Modules', 'Miscellaneous']
cat_order = {c: i for i, c in enumerate(categories)}

data.append(new_entry)
data.sort(key=lambda x: (cat_order.get(x['category'], 999), x['title'].lower()))

# Find position of the new entry for display
pos = next(i for i, x in enumerate(data) if x is new_entry)
total = len(data)
cat_count = sum(1 for x in data if x['category'] == category)

if dry_run:
    print(f"\033[36m[info]\033[0m  Would add: \033[1m{title}\033[0m → {url}")
    print(f"\033[36m[info]\033[0m  Category: {category}, Icon: {icon or '(default)'}")
    print(f"\033[36m[info]\033[0m  Position: #{pos + 1} of {total} (#{cat_count} in {category})")
    # Show neighbours
    if pos > 0:
        prev = data[pos - 1]
        print(f"\033[2m          After:  {prev['title']}\033[0m")
    if pos < total - 1:
        nxt = data[pos + 1]
        print(f"\033[2m          Before: {nxt['title']}\033[0m")
    sys.exit(0)

with open('links/links.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(f"\033[32m[ok]\033[0m    Added \033[1m{title}\033[0m to {category} ({cat_count} in category, {total} total)")
if pos > 0:
    prev = data[pos - 1]
    print(f"\033[2m          After:  {prev['title']}\033[0m")
if pos < total - 1:
    nxt = data[pos + 1]
    print(f"\033[2m          Before: {nxt['title']}\033[0m")
PYEOF
