# PNG Optimization (Automator)

PNG optimization works differently from JPEG optimization. JPEG is inherently lossy, so the challenge there is finding the right quality threshold. PNG is lossless, which means the file faithfully stores every pixel. The opportunity for savings comes from reducing the number of *unique* colors in the image (palette quantization) and then recompressing the result with better algorithms than what most tools use by default.

## How the Pipeline Works

The script runs three tools in sequence, each handling a distinct stage.

**Stage 1: ImageMagick** normalizes the input. It auto-orients from EXIF rotation data, converts to sRGB colorspace, caps resolution at 2560px on the longest edge, and strips metadata. The output is a clean, lossless PNG stream with the alpha channel intact.

**Stage 2: pngquant** performs lossy palette reduction. It takes the full 32-bit RGBA image and reduces it to an 8-bit palette of up to 256 colors. Adaptive dithering ensures smooth gradients, and transparency is fully preserved. This stage is where most of the file size reduction happens, typically 60 to 80 percent. The quality range is configurable: if reducing to 256 colors would push quality below the minimum threshold, pngquant exits and the script falls back to lossless only compression.

**Stage 3: oxipng** applies lossless recompression. It re-encodes the DEFLATE stream with optimized parameters, selects better PNG filter strategies, and strips any remaining non-critical chunks. This typically shaves off another 5 to 15 percent on top of what pngquant saved.

One thing to note about JPEG inputs: the script will process them (useful for transparency compositing workflows), but converting a lossy format to lossless will increase file size. The notification flags this so you know the size comparison is not meaningful in that case.

This is wrapped as an Automator Quick Action, so you can run it directly from Finder's right-click menu.

## How to Set It Up

### 1. Install Dependencies

```
brew install imagemagick pngquant oxipng
```

### 2. Create the Automator Quick Action

Open Automator and create a new **Quick Action**. Set it to receive **files or folders** in **any application**. Add a **Run Shell Script** action, set the shell to `/bin/bash`, and change "Pass input" to **as arguments**.

Paste the following script:

```bash
#!/bin/bash
#
# PNG Optimizer - Automator Quick Action / Shell Script
# Compresses images to optimized PNG via ImageMagick + pngquant (lossy) + oxipng (lossless).
# Preserves transparency. Outputs: {filename}_optimized.png in the same directory as input.
#
# Usage:
#   Automator: Receive files as input > Run Shell Script (pass input as arguments)
#   Terminal:  ./optimize_png.sh file1.png file2.webp ...
#
# Dependencies:
#   brew install imagemagick pngquant oxipng
#
# Compression pipeline:
#   1. ImageMagick: auto-orient, colorspace normalize, optional resize > lossless PNG stream
#   2. pngquant:    lossy palette reduction (32-bit RGBA > 8-bit palette, up to 256 colors)
#                   Typical savings: 60-80%. Preserves alpha channel fully.
#   3. oxipng:      lossless recompression (optimized DEFLATE, filter selection, chunk stripping)
#                   Additional 5-15% on top of pngquant.
#
# pngquant flags explained:
#   --quality 45-80  MAX=80 target, MIN=45 reject floor. Aggressive but safe with adaptive dithering
#   --speed 1        Slowest/best quality. Brute-force palette selection for smallest output
#   --strip          Remove optional metadata chunks (gAMA, cHRM, tEXt, etc.)
#   --skip-if-larger Don't save if quantized result is somehow larger (exit 98)
#
# oxipng flags explained:
#   -o 4             Optimization level (0-6). 4=good balance of speed and compression
#   --strip all      Remove all non-critical chunks
#
# Supported input formats:
#   png, webp, avif, tiff, tif, bmp, gif (first frame), heic, heif, jpg, jpeg
#
# Note on JPEG/lossy inputs:
#   Converting JPEG to PNG increases file size (lossy to lossless). This script will still
#   process them (useful for transparency compositing workflows), but the "savings" shown
#   will be relative to the intermediate PNG, not the original JPEG. The notification flags this.
#

# --- Configuration -----------------------------------------------------------
QUALITY_MIN=45          # pngquant reject floor. Below this, keeps original PNG
QUALITY_MAX=80          # pngquant target quality. Lower = smaller, more palette reduction
SPEED=1                 # pngquant speed 1-11. 1=best quality (slowest), 11=fastest
OXIPNG_LEVEL=4          # oxipng optimization 0-6. 4=good balance. 6=diminishing returns
SUFFIX="_optimized"     # Output filename suffix before extension
MAX_DIM=2560            # Cap longest edge in px (0=no resize). 2560=retina 13"
STRIP_METADATA=true     # Strip metadata in both pngquant and oxipng stages
PRESERVE_TIMESTAMP=true # Copy original file's modification time to output
SKIP_EXISTING=true      # Skip if output exists and is newer than input

# --- Paths -------------------------------------------------------------------
export PATH="/opt/homebrew/bin:$PATH"

# --- Notification helper (escapes quotes in filenames) -----------------------
notify() {
  local msg="${1//\"/\\\"}"
  local title="${2//\"/\\\"}"
  osascript -e "display notification \"$msg\" with title \"$title\"" 2>/dev/null
}

# --- Dependency checks -------------------------------------------------------
missing=""
command -v magick >/dev/null 2>&1 || missing="imagemagick"
command -v pngquant >/dev/null 2>&1 || missing="${missing:+$missing }pngquant"
command -v oxipng >/dev/null 2>&1 || missing="${missing:+$missing }oxipng"
if [ -n "$missing" ]; then
  notify "Missing: ${missing}. Run: brew install ${missing}" "Optimization Error"
  exit 1
fi

# --- Human-readable file sizes -----------------------------------------------
human_size() {
  local b=$1
  if [ "$b" -ge 1048576 ]; then
    printf '%d.%dMB' $((b / 1048576)) $((b % 1048576 * 10 / 1048576))
  elif [ "$b" -ge 1024 ]; then
    printf '%d.%dKB' $((b / 1024)) $((b % 1024 * 10 / 1024))
  else
    printf '%dB' "$b"
  fi
}

# --- Temp file cleanup (batch-safe) -----------------------------------------
TMP_FILES=()
cleanup() {
  for t in "${TMP_FILES[@]}"; do
    rm -f "$t" 2>/dev/null
  done
}
trap cleanup EXIT INT TERM HUP

# --- Counters ----------------------------------------------------------------
success=0
fail=0
skip=0
total_saved=0

# --- Main loop ---------------------------------------------------------------
for f in "$@"; do

  # Guard: file must exist and be a regular file
  if [ ! -f "$f" ]; then
    skip=$((skip + 1))
    continue
  fi

  dir="$(dirname "$f")"
  base="$(basename "${f%.*}")"
  ext="$(echo "${f##*.}" | tr '[:upper:]' '[:lower:]')"
  out="${dir}/${base}${SUFFIX}.png"

  # Skip if output already exists and is newer than input
  if [ "$SKIP_EXISTING" = true ] && [ -f "$out" ] && [ "$out" -nt "$f" ]; then
    skip=$((skip + 1))
    continue
  fi

  # Flag lossy source formats (JPEG to PNG will increase size; user should know)
  lossy_source=false
  case "$ext" in
    jpg|jpeg) lossy_source=true ;;
  esac

  # Validate supported format
  case "$ext" in
    png|webp|avif|tiff|tif|bmp|gif|heic|heif|jpg|jpeg) ;;
    *)
      notify "Unsupported: .${ext}" "Optimization Skipped"
      skip=$((skip + 1))
      continue
      ;;
  esac

  # Create temp files in /tmp (avoids iCloud syncing partial writes)
  tmp_quant="$(mktemp /tmp/.pngquant_XXXXXX.tmp)" || {
    notify "Cannot create temp file" "Optimization Error"
    fail=$((fail + 1))
    continue
  }
  tmp_oxi="$(mktemp /tmp/.oxipng_XXXXXX.tmp)" || {
    rm -f "$tmp_quant"
    notify "Cannot create temp file" "Optimization Error"
    fail=$((fail + 1))
    continue
  }
  TMP_FILES+=("$tmp_quant" "$tmp_oxi")

  # --- Build ImageMagick preprocessing chain ----------------------------------
  magick_args=("$f")

  # Auto-orient from EXIF rotation data
  magick_args+=(-auto-orient)

  # Ensure sRGB colorspace (consistent output regardless of input profile)
  magick_args+=(-colorspace sRGB)

  # Cap resolution if configured (shrink-only; never upscale)
  if [ "$MAX_DIM" -gt 0 ]; then
    magick_args+=(-resize "${MAX_DIM}x${MAX_DIM}>")
  fi

  # Strip metadata if configured (magick level; pngquant/oxipng also strip)
  if [ "$STRIP_METADATA" = true ]; then
    magick_args+=(-strip)
  fi

  # Output as lossless PNG stream (preserves alpha channel)
  magick_args+=(PNG:-)

  # --- pngquant: lossy palette reduction -------------------------------------
  pngquant_args=(
    --quality="${QUALITY_MIN}-${QUALITY_MAX}"
    --speed "$SPEED"
  )
  [ "$STRIP_METADATA" = true ] && pngquant_args+=(--strip)
  pngquant_args+=(--skip-if-larger)
  pngquant_args+=(-)

  magick "${magick_args[@]}" 2>/dev/null \
    | pngquant "${pngquant_args[@]}" > "$tmp_quant" 2>/dev/null
  quant_exit=$?

  # --- Handle pngquant exit codes --------------------------------------------
  if [ "$quant_exit" -eq 99 ]; then
    # Quality below MIN threshold; fall back to magick PNG + oxipng only
    magick "${magick_args[@]}" > "$tmp_quant" 2>/dev/null
    if [ ! -s "$tmp_quant" ]; then
      rm -f "$tmp_quant" "$tmp_oxi"
      notify "Failed: ${base}.${ext}" "Optimization Error"
      fail=$((fail + 1))
      continue
    fi
  elif [ "$quant_exit" -eq 98 ] || [ ! -s "$tmp_quant" ]; then
    # Skip-if-larger triggered or empty output; fall back to magick PNG + oxipng only
    magick "${magick_args[@]}" > "$tmp_quant" 2>/dev/null
    if [ ! -s "$tmp_quant" ]; then
      rm -f "$tmp_quant" "$tmp_oxi"
      notify "Failed: ${base}.${ext}" "Optimization Error"
      fail=$((fail + 1))
      continue
    fi
  fi

  # --- oxipng: lossless recompression ----------------------------------------
  oxipng_args=(-o "$OXIPNG_LEVEL")
  [ "$STRIP_METADATA" = true ] && oxipng_args+=(--strip all)
  oxipng_args+=(--out "$tmp_oxi" "$tmp_quant")

  oxipng "${oxipng_args[@]}" 2>/dev/null
  if [ ! -s "$tmp_oxi" ]; then
    # oxipng failed; use pngquant output directly
    cp "$tmp_quant" "$tmp_oxi"
  fi

  # --- Validate final output -------------------------------------------------
  if [ ! -s "$tmp_oxi" ]; then
    rm -f "$tmp_quant" "$tmp_oxi"
    notify "Failed: ${base}.${ext}" "Optimization Error"
    fail=$((fail + 1))
    continue
  fi

  # --- Compare sizes and finalize --------------------------------------------
  orig=$(stat -f%z "$f")
  comp=$(stat -f%z "$tmp_oxi")

  mv "$tmp_oxi" "$out"
  rm -f "$tmp_quant"

  # Preserve original modification timestamp
  if [ "$PRESERVE_TIMESTAMP" = true ]; then
    touch -r "$f" "$out"
  fi

  if [ "$lossy_source" = true ]; then
    notify "${base}: $(human_size "$comp") (from lossy ${ext}, size comparison N/A)" "Optimized"
  elif [ "$comp" -lt "$orig" ]; then
    saved=$((orig - comp))
    total_saved=$((total_saved + saved))
    pct=$((saved * 100 / orig))
    notify "${base}: $(human_size "$orig") > $(human_size "$comp") (-${pct}%)" "Optimized"
  else
    notify "${base}: re-encoded $(human_size "$comp") (was $(human_size "$orig"))" "Optimized"
  fi
  success=$((success + 1))

done

# --- Batch summary (only for multi-file runs) --------------------------------
if [ "$#" -gt 1 ]; then
  summary="${success} done"
  [ "$total_saved" -gt 0 ] && summary="${summary}, saved $(human_size "$total_saved")"
  [ "$fail" -gt 0 ] && summary="${summary}, ${fail} failed"
  [ "$skip" -gt 0 ] && summary="${summary}, ${skip} skipped"
  notify "$summary" "Batch Complete"
fi
```

### 3. Save and Use

Save the Quick Action as "Optimize PNG" (or whatever you prefer). It will appear when you right-click any file in Finder under Quick Actions.

Select one or more images, right-click, and run it. Each file produces an `_optimized.png` in the same directory with a macOS notification showing the before/after size and savings percentage.

### Configuration

The variables at the top of the script control how each stage behaves.

**QUALITY_MIN** and **QUALITY_MAX** set pngquant's quality range. The max (80) is the target ceiling, and the min (45) is the reject floor. If palette reduction would push quality below 45, pngquant skips that file entirely and the script falls back to lossless only compression via oxipng.

**SPEED** controls pngquant's palette selection algorithm, from 1 (slowest, best quality) to 11 (fastest). The default of 1 uses brute force palette selection for the smallest possible output.

**OXIPNG_LEVEL** sets the lossless recompression effort from 0 to 6. The default of 4 is a good balance between speed and compression. Level 6 offers diminishing returns.

**MAX_DIM** caps the longest edge in pixels. The default of 2560 (retina 13") is usually sufficient. Set to 0 to skip resizing entirely.

**STRIP_METADATA** removes metadata chunks at all three stages: ImageMagick strips EXIF/ICC profiles, pngquant strips optional PNG chunks, and oxipng strips any remaining non-critical data.

**SKIP_EXISTING** will skip files that already have a newer `_optimized.png` output, which is useful when reprocessing a folder.

**PRESERVE_TIMESTAMP** copies the original file's modification date to the output.

Supported input formats include png, webp, avif, tiff, bmp, gif (first frame only), heic, heif, jpg, and jpeg. Transparency is fully preserved through the entire pipeline.
