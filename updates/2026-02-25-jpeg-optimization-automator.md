# JPEG Optimization (Automator)

Photos from phones and cameras are typically 5-15MB each. Most of that data is perceptually invisible - you'd never notice the difference. But when you're storing, sharing, or uploading hundreds of these, it adds up fast.

## The Approach

This script pairs two tools: ImageMagick for preprocessing and mozjpeg for compression.

ImageMagick handles the prep work - auto-orienting from EXIF data, flattening transparency for formats like PNG, normalizing to sRGB colorspace, capping resolution at 2560px (the biggest single saver), and stripping metadata. The result gets piped to mozjpeg as a lossless intermediate.

mozjpeg then does the heavy lifting. It uses MS-SSIM tuning, which optimizes for how humans actually perceive image quality rather than raw pixel differences. At quality 75 with its MS-SSIM quantization table, typical savings land between 60-90% with no visible quality loss.

Wrapping this in an Automator Quick Action means it's a right-click away. No terminal, no remembering flags. Select files, right-click, done.

## How to Set It Up

### 1. Install Dependencies

```
brew install imagemagick mozjpeg
```

### 2. Create the Automator Quick Action

Open Automator and create a new **Quick Action**. Set it to receive **files or folders** in **any application**. Add a **Run Shell Script** action, set the shell to `/bin/bash`, and change "Pass input" to **as arguments**.

Paste the following script:

```bash
#!/bin/bash
#
# JPEG Optimizer - Automator Quick Action / Shell Script
# Converts and compresses images to optimized JPEG via ImageMagick + mozjpeg.
# Outputs: {filename}_optimized.jpeg in the same directory as input.
#
# Usage:
#   Automator: Receive files as input > Run Shell Script (pass input as arguments)
#   Terminal:  ./optimize_jpeg.sh file1.jpg file2.png ...
#
# Dependencies:
#   brew install imagemagick mozjpeg
#
# Compression strategy:
#   This uses mozjpeg's "max compression" preset: quality 75 + tune-ms-ssim + quant-table 2.
#   Combined with a 2560px resolution cap, typical savings are 60-90% on phone/camera photos.
#
# mozjpeg flags explained:
#   -quality 75      Aggressive but perceptually clean with MS-SSIM tuning
#   -tune-ms-ssim    Trellis quantization targeting MS-SSIM (best perceptual metric)
#   -quant-table 2   MS-SSIM-tuned quantization table (complements -tune-ms-ssim)
#   -dct float       Floating-point DCT (marginally better quality at same bitrate)
#   -dc-scan-opt 2   Auto DC scan optimization (progressive encoding efficiency)
#   -sample 2x2      4:2:0 chroma subsampling (standard for photos)
#   -progressive     On by default in mozjpeg; Huffman + scan optimization
#   -optimize        On by default in mozjpeg; Huffman table optimization
#
# Supported input formats:
#   jpg, jpeg, png, tiff, tif, bmp, webp, heic, heif, avif, gif (first frame only)
#

# --- Configuration -----------------------------------------------------------
QUALITY=75              # mozjpeg quality 0-100. 75 + tune-ms-ssim + quant-table 2 = max compression
SUFFIX="_optimized"     # Output filename suffix before extension
MAX_DIM=2560            # Cap longest edge in px (0=no resize). 2560=retina 13". Biggest single saver
BG_COLOR="white"        # Background for transparent inputs (PNG/WebP/AVIF with alpha)
STRIP_METADATA=true     # Strip EXIF/IPTC/XMP/ICC. Set false to preserve copyright/camera data
PRESERVE_TIMESTAMP=true # Copy original file's modification time to output
SKIP_EXISTING=true      # Skip if output exists and is newer than input

# --- Paths -------------------------------------------------------------------
export PATH="/opt/homebrew/bin:$PATH"
CJPEG="/opt/homebrew/opt/mozjpeg/bin/cjpeg"

# --- Notification helper (escapes quotes in filenames) -----------------------
notify() {
  local msg="${1//\"/\\\"}"
  local title="${2//\"/\\\"}"
  osascript -e "display notification \"$msg\" with title \"$title\"" 2>/dev/null
}

# --- Dependency checks -------------------------------------------------------
command -v magick >/dev/null 2>&1 || {
  notify "ImageMagick not installed. Run: brew install imagemagick" "Optimization Error"
  exit 1
}
[ -x "$CJPEG" ] || {
  notify "mozjpeg not installed. Run: brew install mozjpeg" "Optimization Error"
  exit 1
}

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
  out="${dir}/${base}${SUFFIX}.jpeg"

  # Skip if output already exists and is newer than input
  if [ "$SKIP_EXISTING" = true ] && [ -f "$out" ] && [ "$out" -nt "$f" ]; then
    skip=$((skip + 1))
    continue
  fi

  # Validate supported format
  case "$ext" in
    jpg|jpeg|png|tiff|tif|bmp|webp|heic|heif|avif|gif) ;;
    *)
      notify "Unsupported: .${ext}" "Optimization Skipped"
      skip=$((skip + 1))
      continue
      ;;
  esac

  # Create temp file in /tmp (avoids iCloud syncing partial writes)
  tmp="$(mktemp /tmp/.mozjpeg_XXXXXX.tmp)" || {
    notify "Cannot create temp file" "Optimization Error"
    fail=$((fail + 1))
    continue
  }
  TMP_FILES+=("$tmp")

  # --- Build ImageMagick preprocessing chain --------------------------------
  magick_args=("$f")

  # Auto-orient from EXIF rotation data
  magick_args+=(-auto-orient)

  # Flatten transparency to background color (JPEG has no alpha channel)
  case "$ext" in
    png|webp|avif|gif|tiff|tif)
      magick_args+=(-background "$BG_COLOR" -flatten)
      ;;
  esac

  # Ensure sRGB colorspace (consistent output regardless of input profile)
  magick_args+=(-colorspace sRGB)

  # Cap resolution if configured (shrink-only; never upscale)
  if [ "$MAX_DIM" -gt 0 ]; then
    magick_args+=(-resize "${MAX_DIM}x${MAX_DIM}>")
  fi

  # Strip metadata if configured
  if [ "$STRIP_METADATA" = true ]; then
    magick_args+=(-strip)
  fi

  # Output as PPM (lossless intermediate for mozjpeg)
  magick_args+=(pnm:-)

  # --- Encode with mozjpeg --------------------------------------------------
  magick "${magick_args[@]}" 2>/dev/null \
    | "$CJPEG" \
        -quality "$QUALITY" \
        -tune-ms-ssim \
        -quant-table 2 \
        -dct float \
        -dc-scan-opt 2 \
        -sample 2x2 \
        > "$tmp" 2>/dev/null

  # --- Validate output ------------------------------------------------------
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    notify "Failed: ${base}.${ext}" "Optimization Error"
    fail=$((fail + 1))
    continue
  fi

  # --- Compare sizes and finalize -------------------------------------------
  orig=$(stat -f%z "$f")
  comp=$(stat -f%z "$tmp")

  mv "$tmp" "$out"

  # Preserve original modification timestamp
  if [ "$PRESERVE_TIMESTAMP" = true ]; then
    touch -r "$f" "$out"
  fi

  if [ "$comp" -lt "$orig" ]; then
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

Save the Quick Action as "Optimize JPEG" (or whatever you prefer). It'll now appear when you right-click any file in Finder under Quick Actions.

Select one or more images, right-click, and run it. Each file gets an `_optimized.jpeg` output in the same directory. You'll get a macOS notification for each file showing the before/after size and percentage saved.

### Configuration

The script has a configuration block at the top you can tweak:

- **QUALITY** - mozjpeg quality (0-100). Default 75 is aggressive but clean with MS-SSIM tuning.
- **MAX_DIM** - Cap the longest edge in pixels. Default 2560 (retina 13"). Set to 0 to skip resizing.
- **STRIP_METADATA** - Strips EXIF, IPTC, XMP, ICC profiles. Set to false if you need to keep camera data or copyright info.
- **SKIP_EXISTING** - Won't re-process files that already have a newer `_optimized.jpeg` output.
- **PRESERVE_TIMESTAMP** - Copies the original file's modification date to the output.

It handles jpg, jpeg, png, tiff, bmp, webp, heic, heif, avif, and gif (first frame only). Transparent formats get flattened to a white background since JPEG doesn't support alpha.
