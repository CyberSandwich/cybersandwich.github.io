# Office to PDF (Automator)

Every organization has its own preferred document format. Microsoft Office dominates corporate environments, Apple's iWork suite handles personal productivity on macOS, and when the time comes to share something with someone who uses neither, PDF is the format everyone can actually open.

The usual conversion path involves opening each file in its native application, choosing File > Export as PDF, and saving manually. This works for one or two files, but it scales poorly when you have a folder with ten or twenty documents waiting to go out.

## Two Conversion Engines

This script handles both Microsoft Office formats (doc, docx, ppt, pptx, xls, xlsx, and their macro-enabled variants) and Apple iWork formats (Pages, Numbers, Keynote). It picks a different conversion engine depending on what you feed it.

Office formats go through LibreOffice in headless mode. LibreOffice creates a temporary user profile for each conversion session, which avoids conflicts with any running instance and sidesteps the lock file issues that plague automated workflows. Each format type gets its own PDF export filter: `writer_pdf_Export` for documents, `impress_pdf_Export` for presentations, `calc_pdf_Export` for spreadsheets.

Apple formats go through their native applications via AppleScript. Pages, Numbers, and Keynote each have built-in PDF export commands that produce output identical to what you would get from File > Export as PDF. The script tracks whether each application was already running before conversion, and only quits applications that it launched itself. If Keynote was already open with your presentation, it stays open after the conversion finishes.

## The Font Problem

The biggest source of broken conversions is missing fonts. A Word document created on Windows with Calibri body text and Cambria headings will render with substituted fonts on a Mac that has never installed Microsoft Office. The layout shifts, line breaks move, tables reflow, and the resulting PDF looks nothing like the original.

The script handles this automatically on first run. It scans the font directories inside any installed Microsoft Office applications (Word, PowerPoint, Excel, Outlook, OneNote) and creates symbolic links from those embedded fonts into `~/Library/Fonts`. This makes the fonts available system-wide, including to LibreOffice, without copying or modifying the original font files. A marker file at `~/.office_fonts_linked` tracks whether this step has been completed, so it only runs once.

If you do not have any Microsoft Office applications installed, the font linking step simply finds nothing and moves on. LibreOffice ships with its own set of metric-compatible substitution fonts (Liberation Sans, Liberation Serif), which cover the most common Office typefaces reasonably well.

## PDF Compression

After conversion, the raw PDFs from LibreOffice and Apple's apps are often larger than necessary. LibreOffice in particular tends to produce uncompressed or poorly compressed object streams.

The script passes each PDF through qpdf as a post-processing step. qpdf regenerates object streams, recompresses all FLATE streams at maximum compression level, and linearizes the output for fast web viewing (the PDF loads progressively when opened over a network). If the compressed version is smaller, it replaces the original. If compression somehow makes the file larger (this can happen with already-optimized PDFs), the original is kept as is.

Compression is optional. If qpdf is not installed, conversions still work; the PDFs just won't be as compact.

## How to Set It Up

### 1. Install Dependencies

```
brew install --cask libreoffice
brew install qpdf
```

LibreOffice handles all Microsoft Office format conversions. qpdf is optional but recommended for post-conversion PDF compression.

### 2. Create the Automator Quick Action

Open Automator and create a new **Quick Action**. Set it to receive **files or folders** in **any application**. Add a **Run Shell Script** action, set the shell to `/bin/zsh`, and change "Pass input" to **as arguments**.

Note that this script uses zsh rather than bash (unlike the image optimization scripts in this series). The zsh-specific features include lowercase expansion with `${var:l}`, array membership testing with `${array[(Ie)value]}`, and glob qualifiers like `(N)` for null glob.

Paste the following script:

```bash
#!/bin/zsh
# ============================================================
# Convert to PDF — Automator Quick Action
#
# Supported formats:
#   Office:  doc, docx, docm, ppt, pptx, pptm, xls, xlsx, xlsm
#   Apple:   pages, numbers, key
#
# Prerequisites:
#   brew install --cask libreoffice
#   brew install qpdf
#
# Automator setup:
#   Workflow receives: files or folders | in: Finder
#   Action: Run Shell Script
#   Shell: /bin/zsh
#   Pass input: as arguments
# ============================================================

SOFFICE="/Applications/LibreOffice.app/Contents/MacOS/soffice"
QPDF="/opt/homebrew/bin/qpdf"
FONT_MARKER="$HOME/.office_fonts_linked"
LOG=$(mktemp /tmp/convert_pdf_XXXXXX.log)
STAGING=$(mktemp -d /tmp/convert_pdf_stage_XXXXXX)

success=0
fail=0
skip=0
total_orig_bytes=0
total_comp_bytes=0
failed_names=()

office_exts=(doc docx docm ppt pptx pptm xls xlsx xlsm)
apple_exts=(pages numbers key)
all_exts=($office_exts $apple_exts)

log() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Convert to PDF\"" 2>/dev/null; }

get_pdf_filter() {
    case "$1" in
        doc|docx|docm) echo "writer_pdf_Export" ;;
        ppt|pptx|pptm) echo "impress_pdf_Export" ;;
        xls|xlsx|xlsm) echo "calc_pdf_Export" ;;
    esac
}

record_failure() {
    fail=$((fail + 1))
    failed_names+=("$1")
    log "  FAILED: $2"
}

resolve_output_path() {
    local dir="$1" base="$2"
    local candidate="${dir}/${base}.pdf"
    if [[ ! -f "$candidate" ]]; then echo "$candidate"; return; fi
    candidate="${dir}/${base} (converted).pdf"
    if [[ ! -f "$candidate" ]]; then echo "$candidate"; return; fi
    echo "${dir}/${base} (converted $(date '+%Y%m%d_%H%M%S')).pdf"
}

compress_pdf() {
    local pdf_path="$1"
    local orig_size=$(stat -f%z "$pdf_path")
    total_orig_bytes=$((total_orig_bytes + orig_size))

    if [[ ! -x "$QPDF" ]]; then
        total_comp_bytes=$((total_comp_bytes + orig_size))
        return
    fi

    local tmp_compressed="${pdf_path}.compressed"

    "$QPDF" \
        --object-streams=generate \
        --compress-streams=y \
        --recompress-flate \
        --compression-level=9 \
        --linearize \
        "$pdf_path" "$tmp_compressed" >/dev/null 2>&1

    if [[ -f "$tmp_compressed" && -s "$tmp_compressed" ]]; then
        local comp_size=$(stat -f%z "$tmp_compressed")
        if [[ $comp_size -lt $orig_size ]]; then
            local saved=$(( (orig_size - comp_size) * 100 / orig_size ))
            mv -f "$tmp_compressed" "$pdf_path"
            total_comp_bytes=$((total_comp_bytes + comp_size))
            log "  Compressed: $(( orig_size / 1024 ))KB → $(( comp_size / 1024 ))KB (${saved}% smaller)"
        else
            rm -f "$tmp_compressed"
            total_comp_bytes=$((total_comp_bytes + orig_size))
            log "  Compression skipped: already optimal"
        fi
    else
        rm -f "$tmp_compressed"
        total_comp_bytes=$((total_comp_bytes + orig_size))
        log "  Compression skipped: no output"
    fi
}

convert_apple() {
    local input_posix="$1" output_posix="$2" ext="$3"
    case "$ext" in
        pages)
            osascript <<EOF 2>&1
tell application "Pages"
    set theDoc to open POSIX file "$input_posix" as alias
    delay 1
    export theDoc to POSIX file "$output_posix" as PDF
    close theDoc saving no
end tell
EOF
            ;;
        numbers)
            osascript <<EOF 2>&1
tell application "Numbers"
    set theDoc to open POSIX file "$input_posix" as alias
    delay 1
    export theDoc to POSIX file "$output_posix" as PDF
    close theDoc saving no
end tell
EOF
            ;;
        key)
            osascript <<EOF 2>&1
tell application "Keynote"
    set theDoc to open POSIX file "$input_posix" as alias
    delay 1
    export theDoc to POSIX file "$output_posix" as PDF
    close theDoc saving no
end tell
EOF
            ;;
    esac
}

convert_office() {
    local input_posix="$1" outdir="$2" ext="$3"
    local pdf_filter="$(get_pdf_filter "$ext")"
    "$SOFFICE" \
        --headless --norestore --nolockcheck \
        "-env:UserInstallation=$PROFILE_URI" \
        --convert-to "pdf:$pdf_filter" \
        --outdir "$outdir" \
        "$input_posix" 2>&1
}

# ---- Preflight ----

if [[ ! -x "$SOFFICE" ]]; then
    osascript -e 'display dialog "LibreOffice is required." & return & return & "Run: brew install --cask libreoffice" with title "Convert to PDF" buttons {"OK"} default button "OK" with icon stop' 2>/dev/null
    exit 1
fi

[[ ! -x "$QPDF" ]] && log "WARNING: qpdf not found — install with: brew install qpdf"
[[ $# -eq 0 ]] && { notify "No files selected."; exit 0; }

# ---- Auto-link Microsoft fonts (first run) ----

if [[ ! -f "$FONT_MARKER" ]]; then
    log "Linking Microsoft Office fonts"
    mkdir -p "$HOME/Library/Fonts"
    linked=0
    for app_path in \
        "/Applications/Microsoft Word.app" \
        "/Applications/Microsoft PowerPoint.app" \
        "/Applications/Microsoft Excel.app" \
        "/Applications/Microsoft Outlook.app" \
        "/Applications/Microsoft OneNote.app"; do
        [[ ! -d "$app_path" ]] && continue
        for subdir in DFonts Fonts .; do
            for font in "$app_path"/Contents/Resources/"$subdir"/*.{ttf,ttc,otf}(N); do
                [[ ! -f "$font" ]] && continue
                fname="$(basename "$font")"
                [[ ! -e "$HOME/Library/Fonts/$fname" ]] && ln -sf "$font" "$HOME/Library/Fonts/$fname" 2>/dev/null && linked=$((linked + 1))
            done
        done
    done
    touch "$FONT_MARKER"
    log "Linked $linked fonts"
fi

# ---- Temp LibreOffice profile ----

PROFILE_DIR="/tmp/libreoffice_convert_$$"
PROFILE_URI="file://$PROFILE_DIR"
mkdir -p "$PROFILE_DIR/user"
[[ -f "$PROFILE_DIR/user/.lock" ]] && rm -f "$PROFILE_DIR/user/.lock"

# ---- Track Apple app state ----

pages_was=$(pgrep -x "Pages" >/dev/null 2>&1 && echo 1 || echo 0)
numbers_was=$(pgrep -x "Numbers" >/dev/null 2>&1 && echo 1 || echo 0)
keynote_was=$(pgrep -x "Keynote" >/dev/null 2>&1 && echo 1 || echo 0)
pages_used=0; numbers_used=0; keynote_used=0

# ---- Main loop ----

log "Processing $# file(s)"

for f in "$@"; do
    fname="$(basename "$f")"
    log "File: $fname"

    [[ ! -e "$f" ]] && { record_failure "$fname" "not found"; continue; }
    [[ ! -f "$f" ]] && { record_failure "$fname" "not a regular file"; continue; }
    [[ ! -s "$f" ]] && { record_failure "$fname" "empty"; continue; }
    [[ "$fname" == .*.icloud ]] && { record_failure "$fname" "iCloud placeholder"; continue; }

    ext_lower="${f##*.}"
    ext_lower="${ext_lower:l}"

    (( ! ${all_exts[(Ie)$ext_lower]} )) && { log "  SKIP: .$ext_lower"; skip=$((skip + 1)); continue; }

    dir_path="$(dirname "$f")"
    base_name="${fname%.*}"

    [[ ! -w "$dir_path" ]] && { record_failure "$fname" "directory not writable"; continue; }

    final_path="$(resolve_output_path "$dir_path" "$base_name")"
    staged_pdf="${STAGING}/${base_name}.pdf"

    # ---- Convert to staging ----

    if (( ${apple_exts[(Ie)$ext_lower]} )); then
        log "  Engine: native → staging"
        case "$ext_lower" in
            pages)  pages_used=1 ;;
            numbers) numbers_used=1 ;;
            key)    keynote_used=1 ;;
        esac
        conv_output=$(convert_apple "$f" "$staged_pdf" "$ext_lower")
        log "  $conv_output"

    elif (( ${office_exts[(Ie)$ext_lower]} )); then
        log "  Engine: LibreOffice → staging"
        conv_output=$(convert_office "$f" "$STAGING" "$ext_lower")
        log "  $conv_output"
    fi

    # ---- Compress in staging ----

    if [[ -f "$staged_pdf" && -s "$staged_pdf" ]]; then
        compress_pdf "$staged_pdf"
    else
        [[ -f "$staged_pdf" ]] && rm -f "$staged_pdf"
        record_failure "$fname" "PDF not created"
        continue
    fi

    # ---- Move final result to destination ----

    if [[ -f "$staged_pdf" && -s "$staged_pdf" ]]; then
        cp -f "$staged_pdf" "$final_path"
        if [[ $? -eq 0 ]]; then
            rm -f "$staged_pdf"
            log "  OK → $final_path"
            success=$((success + 1))
        else
            record_failure "$fname" "failed to copy to destination"
            rm -f "$staged_pdf"
        fi
    else
        record_failure "$fname" "staged PDF missing after compression"
    fi
done

# ---- Cleanup ----

rm -rf "$STAGING" 2>/dev/null
rm -rf "$PROFILE_DIR" 2>/dev/null

[[ $pages_used -eq 1 && $pages_was -eq 0 ]] && osascript -e 'tell application "Pages" to quit' 2>/dev/null &
[[ $numbers_used -eq 1 && $numbers_was -eq 0 ]] && osascript -e 'tell application "Numbers" to quit' 2>/dev/null &
[[ $keynote_used -eq 1 && $keynote_was -eq 0 ]] && osascript -e 'tell application "Keynote" to quit' 2>/dev/null &

# ---- Notification ----

log ""
log "Done: $success ok, $fail failed, $skip skipped"
if [[ $total_orig_bytes -gt 0 && $total_comp_bytes -lt $total_orig_bytes ]]; then
    pct=$(( (total_orig_bytes - total_comp_bytes) * 100 / total_orig_bytes ))
    log "Total compression: $(( total_orig_bytes / 1024 ))KB → $(( total_comp_bytes / 1024 ))KB (${pct}%)"
fi

comp_msg=""
if [[ $total_orig_bytes -gt 0 && $total_comp_bytes -lt $total_orig_bytes ]]; then
    pct=$(( (total_orig_bytes - total_comp_bytes) * 100 / total_orig_bytes ))
    comp_msg=" (${pct}% compressed)"
fi

if [[ $fail -eq 0 && $success -gt 0 ]]; then
    notify "$success file(s) converted.${comp_msg}"
    rm -f "$LOG"
elif [[ $fail -gt 0 && $success -gt 0 ]]; then
    joined=$(IFS=', '; echo "${failed_names[*]}")
    notify "$success converted${comp_msg}, $fail failed. Log on Desktop."
    cp "$LOG" "$HOME/Desktop/convert_to_pdf_log.txt" 2>/dev/null
    rm -f "$LOG"
elif [[ $fail -gt 0 ]]; then
    joined=$(IFS=', '; echo "${failed_names[*]}")
    notify "All $fail file(s) failed. Log on Desktop."
    cp "$LOG" "$HOME/Desktop/convert_to_pdf_log.txt" 2>/dev/null
    rm -f "$LOG"
elif [[ $skip -gt 0 ]]; then
    notify "No supported files in selection."
    rm -f "$LOG"
else
    rm -f "$LOG"
fi
```

### 3. Save and Use

Save the Quick Action as "Convert to PDF" (or whatever you prefer). It will appear when you right-click any file in Finder under Quick Actions.

Select one or more Office or iWork files, right-click, and run it. Each file produces a PDF in the same directory with a macOS notification showing the result. If a PDF with the same base name already exists, the output gets a "(converted)" suffix to avoid overwriting. If that also exists, it falls back to a timestamped name.

### Compatibility

Supported Office formats: doc, docx, docm, ppt, pptx, pptm, xls, xlsx, xlsm (all via LibreOffice). Supported Apple formats: pages, numbers, key (via native AppleScript).

The script detects and skips iCloud placeholder files (the `.icloud` stubs that appear when a file has not been downloaded locally). These need to be downloaded from iCloud before they can be converted.

### Configuration

**SOFFICE** points to the LibreOffice binary location. The default path matches a standard Homebrew cask installation. If you installed LibreOffice manually or through a different method, update this path accordingly.

**QPDF** points to the qpdf binary for post-conversion PDF compression. If qpdf is not installed, the script skips compression entirely and still produces valid PDFs. The compression step regenerates object streams, recompresses FLATE data at level 9, and linearizes the output.

**FONT_MARKER** is the path to a sentinel file that tracks whether Microsoft fonts have been linked. Delete this file if you install new Office applications and want the script to re-scan for fonts on its next run.

The output filename collision logic works in three tiers: it first tries `{name}.pdf`, then `{name} (converted).pdf`, then `{name} (converted {timestamp}).pdf`. This means running the script multiple times on the same file will not overwrite previous conversions.

Failed conversions are logged to a temporary file. If any files fail, the log is copied to your Desktop as `convert_to_pdf_log.txt` for troubleshooting. If everything succeeds, the log is removed automatically.
