#!/usr/bin/env zsh
# bump-shared.sh — Cache buster manager for saputra.co.uk
# Bumps ?v= params for shared/base.css, shared/base.js, shared/swr.js, shared/search.js,
# style.css, app.js, codegen/shared.js, codegen/shared.css, imageopt/shared.js, and imageopt/shared.css.
#
# Usage:
#   ./scripts/bump-shared.sh              Auto-detect git changes and bump
#   ./scripts/bump-shared.sh status       Show current versions across all files
#   ./scripts/bump-shared.sh verify       Check all versions are in sync
#   ./scripts/bump-shared.sh css          Bump shared/base.css across sub-projects
#   ./scripts/bump-shared.sh js           Bump shared/base.js across sub-projects
#   ./scripts/bump-shared.sh swr-js       Bump shared/swr.js across consumers
#   ./scripts/bump-shared.sh both         Bump all shared files
#   ./scripts/bump-shared.sh main-css     Bump style.css in index.html
#   ./scripts/bump-shared.sh main-js      Bump app.js in index.html
#   ./scripts/bump-shared.sh main         Bump both main SPA files
#   ./scripts/bump-shared.sh codegen-js    Bump codegen/shared.js across codegen files
#   ./scripts/bump-shared.sh codegen-css  Bump codegen/shared.css across codegen files
#   ./scripts/bump-shared.sh codegen      Bump both codegen shared files
#   ./scripts/bump-shared.sh imageopt-js   Bump imageopt/shared.js across imageopt files
#   ./scripts/bump-shared.sh imageopt-css  Bump imageopt/shared.css across imageopt files
#   ./scripts/bump-shared.sh imageopt      Bump both imageopt shared files
#   ./scripts/bump-shared.sh all          Bump everything
#   ./scripts/bump-shared.sh set <N>      Set all shared versions to specific number
#   ./scripts/bump-shared.sh --dry-run .. Preview without writing
#   ./scripts/bump-shared.sh -n ..        Alias for --dry-run

set -euo pipefail
cd "${0:A:h}/.."

# ── Formatting ──────────────────────────────────────────────────────
B='\033[1m' D='\033[2m' G='\033[32m' Y='\033[33m'
R='\033[31m' C='\033[36m' Z='\033[0m'
ok()   { printf "${G}[ok]${Z}    %b\n" "$*"; }
warn() { printf "${Y}[warn]${Z}  %b\n" "$*"; }
err()  { printf "${R}[err]${Z}   %b\n" "$*" >&2; }
info() { printf "${C}[info]${Z}  %b\n" "$*"; }
dim()  { printf "${D}%s${Z}\n" "$*"; }

# ── Config ──────────────────────────────────────────────────────────
MAIN_HTML="index.html"
DRY_RUN=false

# Auto-discover sub-project HTML files
SUB_HTMLS=()
for f in $(find . -name "index.html" -not -path "./$MAIN_HTML" -not -path "./.git/*" | sort); do
  SUB_HTMLS+=("$f")
done

# ── Core ────────────────────────────────────────────────────────────
# Find all unique versions of a file pattern across given target files
find_versions() {
  local file=$1; shift
  local targets=("$@")
  local versions=()
  for t in "${targets[@]}"; do
    local v=$(grep -o "${file}?v=[0-9]*" "$t" 2>/dev/null | grep -o '[0-9]*$' || true)
    [[ -n "$v" ]] && versions+=("$v")
  done
  print -l "${versions[@]}" 2>/dev/null | sort -un
}

# Get the current (highest) version, warn on drift
current_version() {
  local file=$1; shift
  local targets=("$@")
  local versions=(${(f)"$(find_versions "$file" "${targets[@]}")"})
  (( ${#versions} == 0 )) && return
  (( ${#versions} > 1 )) && warn "Version drift for ${B}${file}${Z}: ${versions[*]}"
  echo "${versions[-1]}"
}

# Count how many target files contain a specific version
count_files() {
  local file=$1 ver=$2; shift 2
  local targets=("$@")
  local c=0
  for t in "${targets[@]}"; do
    grep -q "${file}?v=${ver}" "$t" 2>/dev/null && (( c++ ))
  done
  echo "$c"
}

# Count total references (a file may have multiple, e.g. preload + script)
count_refs() {
  local file=$1 ver=$2; shift 2
  local targets=("$@")
  local c=0
  for t in "${targets[@]}"; do
    local n=$(grep -c "${file}?v=${ver}" "$t" 2>/dev/null || true)
    (( c += n ))
  done
  echo "$c"
}

# Bump a file's version across target files
bump() {
  local file=$1; shift
  local targets=("$@")
  local cur=$(current_version "$file" "${targets[@]}")

  if [[ -z "$cur" ]]; then
    dim "  No ${file}?v= references found — skipping."
    return
  fi

  local new=$((cur + 1))
  local file_count=$(count_files "$file" "$cur" "${targets[@]}")

  if $DRY_RUN; then
    info "Would bump ${B}${file}${Z}: v=${cur} -> v=${new} (${file_count} files)"
    return
  fi

  for t in "${targets[@]}"; do
    sed -i '' "s|${file}?v=${cur}|${file}?v=${new}|g" "$t" 2>/dev/null || true
  done

  local updated=$(count_files "$file" "$new" "${targets[@]}")
  local refs=$(count_refs "$file" "$new" "${targets[@]}")
  ok "${B}${file}${Z}: v=${cur} -> v=${new} (${updated} files, ${refs} refs)"
}

# Set a file's version to a specific number
set_ver() {
  local file=$1 ver=$2; shift 2
  local targets=("$@")

  if $DRY_RUN; then
    info "Would set ${B}${file}${Z} to v=${ver}"
    return
  fi

  for t in "${targets[@]}"; do
    sed -i '' "s|${file}?v=[0-9]*|${file}?v=${ver}|g" "$t" 2>/dev/null || true
  done

  local updated=$(count_files "$file" "$ver" "${targets[@]}")
  ok "${B}${file}${Z}: set to v=${ver} (${updated} files)"
}

# All HTML files (sub-projects + main) for search.js bumping
ALL_HTMLS=("${SUB_HTMLS[@]}" "$MAIN_HTML")

# Codegen HTML files (consumers of codegen/shared.js and codegen/shared.css)
CODEGEN_HTMLS=("./codegen/index.html" "./codegen/barcode/index.html" "./codegen/aztec/index.html")

# ImageOpt HTML files (consumers of imageopt/shared.js and imageopt/shared.css)
IMAGEOPT_HTMLS=("./imageopt/index.html" "./imageopt/png/index.html")

# ── Commands ────────────────────────────────────────────────────────
cmd_status() {
  printf "\n${B}Cache Buster Status${Z}\n"
  printf "%-14s %-10s %-8s %-8s %s\n" "File" "Version" "Files" "Refs" "Scope"
  printf "%-14s %-10s %-8s %-8s %s\n" "──────────" "───────" "─────" "────" "─────"

  for f in base.css base.js; do
    local v=$(current_version "$f" "${ALL_HTMLS[@]}")
    local fc=$(count_files "$f" "$v" "${ALL_HTMLS[@]}")
    local rc=$(count_refs "$f" "$v" "${ALL_HTMLS[@]}")
    local drift=""
    local versions=(${(f)"$(find_versions "$f" "${ALL_HTMLS[@]}")"})
    (( ${#versions} > 1 )) && drift=" ${R}DRIFT${Z}"
    printf "%-14s %-10s %-8s %-8s %b\n" "$f" "v=${v:-?}" "$fc" "$rc" "all HTML${drift}"
  done

  for f in swr.js search.js; do
    local v=$(current_version "$f" "${ALL_HTMLS[@]}")
    local fc=$(count_files "$f" "$v" "${ALL_HTMLS[@]}")
    local rc=$(count_refs "$f" "$v" "${ALL_HTMLS[@]}")
    local drift=""
    local versions=(${(f)"$(find_versions "$f" "${ALL_HTMLS[@]}")"})
    (( ${#versions} > 1 )) && drift=" ${R}DRIFT${Z}"
    printf "%-14s %-10s %-8s %-8s %b\n" "$f" "v=${v:-?}" "$fc" "$rc" "all HTML${drift}"
  done

  for f in shared.js shared.css; do
    local v=$(current_version "$f" "${CODEGEN_HTMLS[@]}")
    local fc=$(count_files "$f" "$v" "${CODEGEN_HTMLS[@]}")
    local rc=$(count_refs "$f" "$v" "${CODEGEN_HTMLS[@]}")
    local drift=""
    local versions=(${(f)"$(find_versions "$f" "${CODEGEN_HTMLS[@]}")"})
    (( ${#versions} > 1 )) && drift=" ${R}DRIFT${Z}"
    printf "%-14s %-10s %-8s %-8s %b\n" "cg/$f" "v=${v:-?}" "$fc" "$rc" "codegen${drift}"
  done

  for f in shared.js shared.css; do
    local v=$(current_version "$f" "${IMAGEOPT_HTMLS[@]}")
    local fc=$(count_files "$f" "$v" "${IMAGEOPT_HTMLS[@]}")
    local rc=$(count_refs "$f" "$v" "${IMAGEOPT_HTMLS[@]}")
    local drift=""
    local versions=(${(f)"$(find_versions "$f" "${IMAGEOPT_HTMLS[@]}")"})
    (( ${#versions} > 1 )) && drift=" ${R}DRIFT${Z}"
    printf "%-14s %-10s %-8s %-8s %b\n" "io/$f" "v=${v:-?}" "$fc" "$rc" "imageopt${drift}"
  done

  for f in style.css app.js; do
    local v=$(current_version "$f" "$MAIN_HTML")
    local rc=$(count_refs "$f" "$v" "$MAIN_HTML")
    printf "%-14s %-10s %-8s %-8s %s\n" "$f" "v=${v:-?}" "1" "$rc" "index.html"
  done

  # Sync check
  local css_v=$(current_version "base.css" "${ALL_HTMLS[@]}")
  local js_v=$(current_version "base.js" "${ALL_HTMLS[@]}")
  printf "\n"
  if [[ "$css_v" == "$js_v" ]] 2>/dev/null; then
    ok "Shared files in sync (both v=${css_v})"
  else
    warn "Shared files out of sync: base.css=v${css_v:-?}, base.js=v${js_v:-?}"
  fi

  printf "\n${D}Sub-projects (${#SUB_HTMLS[@]} files):${Z}\n"
  for f in "${SUB_HTMLS[@]}"; do dim "  ${f#./}"; done
  printf "\n"
}

cmd_verify() {
  local errors=0
  for f in base.css base.js; do
    local versions=(${(f)"$(find_versions "$f" "${ALL_HTMLS[@]}")"})
    if (( ${#versions} > 1 )); then
      err "Version drift in ${B}${f}${Z}: ${versions[*]}"
      for v in "${versions[@]}"; do
        for t in "${ALL_HTMLS[@]}"; do
          grep -q "${f}?v=${v}" "$t" 2>/dev/null && dim "  v=${v}: ${t#./}"
        done
      done
      (( errors++ ))
    fi
  done
  for f in swr.js search.js; do
    local versions=(${(f)"$(find_versions "$f" "${ALL_HTMLS[@]}")"})
    if (( ${#versions} > 1 )); then
      err "Version drift in ${B}${f}${Z}: ${versions[*]}"
      for v in "${versions[@]}"; do
        for t in "${ALL_HTMLS[@]}"; do
          grep -q "${f}?v=${v}" "$t" 2>/dev/null && dim "  v=${v}: ${t#./}"
        done
      done
      (( errors++ ))
    fi
  done
  for f in shared.js shared.css; do
    local versions=(${(f)"$(find_versions "$f" "${CODEGEN_HTMLS[@]}")"})
    if (( ${#versions} > 1 )); then
      err "Version drift in ${B}codegen/${f}${Z}: ${versions[*]}"
      for v in "${versions[@]}"; do
        for t in "${CODEGEN_HTMLS[@]}"; do
          grep -q "${f}?v=${v}" "$t" 2>/dev/null && dim "  v=${v}: ${t#./}"
        done
      done
      (( errors++ ))
    fi
  done
  for f in shared.js shared.css; do
    local versions=(${(f)"$(find_versions "$f" "${IMAGEOPT_HTMLS[@]}")"})
    if (( ${#versions} > 1 )); then
      err "Version drift in ${B}imageopt/${f}${Z}: ${versions[*]}"
      for v in "${versions[@]}"; do
        for t in "${IMAGEOPT_HTMLS[@]}"; do
          grep -q "${f}?v=${v}" "$t" 2>/dev/null && dim "  v=${v}: ${t#./}"
        done
      done
      (( errors++ ))
    fi
  done
  if (( errors == 0 )); then
    ok "All versions in sync."
  else
    err "${errors} drift issue(s) found. Run 'set <N>' to fix."
    exit 1
  fi
}

cmd_auto() {
  info "Auto-detecting changed files..."
  local changed bumped=false
  changed=$(git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null) || true

  if echo "$changed" | grep -q "shared/base.css"; then
    info "Detected shared/base.css change"
    bump "base.css" "${ALL_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "shared/base.js"; then
    info "Detected shared/base.js change"
    bump "base.js" "${ALL_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "shared/swr.js"; then
    info "Detected shared/swr.js change"
    bump "swr.js" "${ALL_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "shared/search.js"; then
    info "Detected shared/search.js change"
    bump "search.js" "${ALL_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "^style.css$"; then
    info "Detected style.css change"
    bump "style.css" "$MAIN_HTML"
    bumped=true
  fi
  if echo "$changed" | grep -q "^app.js$"; then
    info "Detected app.js change"
    bump "app.js" "$MAIN_HTML"
    bumped=true
  fi
  if echo "$changed" | grep -q "codegen/shared.js"; then
    info "Detected codegen/shared.js change"
    bump "shared.js" "${CODEGEN_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "codegen/shared.css"; then
    info "Detected codegen/shared.css change"
    bump "shared.css" "${CODEGEN_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "imageopt/shared.js"; then
    info "Detected imageopt/shared.js change"
    bump "shared.js" "${IMAGEOPT_HTMLS[@]}"
    bumped=true
  fi
  if echo "$changed" | grep -q "imageopt/shared.css"; then
    info "Detected imageopt/shared.css change"
    bump "shared.css" "${IMAGEOPT_HTMLS[@]}"
    bumped=true
  fi

  if ! $bumped; then
    dim "No CSS/JS changes detected. Nothing to bump."
    dim "Run with a target (css, js, both, main, all) or 'status'."
  fi
}

# ── Parse args ──────────────────────────────────────────────────────
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=true ;;
    *) ARGS+=("$arg") ;;
  esac
done

CMD="${ARGS[1]:-auto}"
$DRY_RUN && info "Dry-run mode — no files will be modified."

case "$CMD" in
  status|s)    cmd_status ;;
  verify|check) cmd_verify ;;
  css)         bump "base.css" "${ALL_HTMLS[@]}" ;;
  js)          bump "base.js" "${ALL_HTMLS[@]}" ;;
  search-js)   bump "search.js" "${ALL_HTMLS[@]}" ;;
  swr-js)      bump "swr.js" "${ALL_HTMLS[@]}" ;;
  both|shared) bump "base.css" "${ALL_HTMLS[@]}"; bump "base.js" "${ALL_HTMLS[@]}"
               bump "swr.js" "${ALL_HTMLS[@]}"; bump "search.js" "${ALL_HTMLS[@]}" ;;
  main-css)    bump "style.css" "$MAIN_HTML" ;;
  main-js)     bump "app.js" "$MAIN_HTML" ;;
  main)        bump "style.css" "$MAIN_HTML"; bump "app.js" "$MAIN_HTML" ;;
  codegen-js)  bump "shared.js" "${CODEGEN_HTMLS[@]}" ;;
  codegen-css) bump "shared.css" "${CODEGEN_HTMLS[@]}" ;;
  codegen)     bump "shared.js" "${CODEGEN_HTMLS[@]}"; bump "shared.css" "${CODEGEN_HTMLS[@]}" ;;
  imageopt-js)  bump "shared.js" "${IMAGEOPT_HTMLS[@]}" ;;
  imageopt-css) bump "shared.css" "${IMAGEOPT_HTMLS[@]}" ;;
  imageopt)     bump "shared.js" "${IMAGEOPT_HTMLS[@]}"; bump "shared.css" "${IMAGEOPT_HTMLS[@]}" ;;
  all)         bump "base.css" "${ALL_HTMLS[@]}"; bump "base.js" "${ALL_HTMLS[@]}"
               bump "swr.js" "${ALL_HTMLS[@]}"; bump "search.js" "${ALL_HTMLS[@]}"
               bump "shared.js" "${CODEGEN_HTMLS[@]}"; bump "shared.css" "${CODEGEN_HTMLS[@]}"
               bump "shared.js" "${IMAGEOPT_HTMLS[@]}"; bump "shared.css" "${IMAGEOPT_HTMLS[@]}"
               bump "style.css" "$MAIN_HTML"; bump "app.js" "$MAIN_HTML" ;;
  set)
    V="${ARGS[2]:-}"
    if [[ -z "$V" ]] || ! [[ "$V" =~ ^[0-9]+$ ]]; then
      err "Usage: $0 set <version-number>"; exit 1
    fi
    set_ver "base.css" "$V" "${ALL_HTMLS[@]}"
    set_ver "base.js" "$V" "${ALL_HTMLS[@]}"
    set_ver "swr.js" "$V" "${ALL_HTMLS[@]}"
    set_ver "search.js" "$V" "${ALL_HTMLS[@]}"
    ;;
  auto)        cmd_auto ;;
  help|-h|--help)
    printf "${B}bump-shared.sh${Z} — Cache buster manager\n\n"
    printf "Commands:\n"
    printf "  ${C}(none)${Z}      Auto-detect git changes and bump\n"
    printf "  ${C}status${Z}      Show current versions\n"
    printf "  ${C}verify${Z}      Check versions are in sync\n"
    printf "  ${C}css${Z}         Bump shared/base.css\n"
    printf "  ${C}js${Z}          Bump shared/base.js\n"
    printf "  ${C}swr-js${Z}      Bump shared/swr.js\n"
    printf "  ${C}search-js${Z}   Bump shared/search.js\n"
    printf "  ${C}both${Z}        Bump all shared files\n"
    printf "  ${C}main-css${Z}    Bump style.css in index.html\n"
    printf "  ${C}main-js${Z}     Bump app.js in index.html\n"
    printf "  ${C}main${Z}        Bump both main SPA files\n"
    printf "  ${C}codegen-js${Z}  Bump codegen/shared.js\n"
    printf "  ${C}codegen-css${Z} Bump codegen/shared.css\n"
    printf "  ${C}codegen${Z}     Bump both codegen shared files\n"
    printf "  ${C}imageopt-js${Z} Bump imageopt/shared.js\n"
    printf "  ${C}imageopt-css${Z} Bump imageopt/shared.css\n"
    printf "  ${C}imageopt${Z}    Bump both imageopt shared files\n"
    printf "  ${C}all${Z}         Bump everything\n"
    printf "  ${C}set <N>${Z}     Set all shared versions to N\n"
    printf "\nFlags:\n"
    printf "  ${C}--dry-run${Z}   Preview without writing\n"
    printf "  ${C}-n${Z}          Alias for --dry-run\n"
    ;;
  *)
    err "Unknown command: $CMD"
    printf "Run ${C}$0 help${Z} for usage.\n"
    exit 1
    ;;
esac
