# HEIC Optimization (Automator)

HEIC is what happens when you take a video codec and use it to compress a single frame. The container is HEIF (High Efficiency Image Format), and the compression inside is HEVC (H.265), the same codec that powers 4K video streaming. Apple adopted it as the default camera format starting with iOS 11 and macOS High Sierra, which means most iPhone photos taken since 2017 are already HEIC. The format consistently produces files 40 to 50 percent smaller than equivalent quality JPEG, and it supports features like embedded thumbnails, depth maps, and HDR metadata that JPEG simply cannot represent.

## Why the Pipeline Looks Different

Unlike the JPEG and PNG optimizers in this series, the HEIC pipeline has a constraint that shapes everything: `heif-enc` cannot read from stdin. Most image tools accept piped input, which lets you chain ImageMagick directly into the encoder. `heif-enc` needs a real file on disk, and it uses the file extension to detect the input format. This means the script writes an intermediate PNG to a temp directory before encoding, rather than streaming through a pipe.

The quality scale also works differently from JPEG. HEIC quality 50 is roughly equivalent to JPEG quality 80 to 85 in perceptual terms, because the underlying x265 encoder maps the quality value to a CRF (Constant Rate Factor) internally. The default of 40 in this script targets roughly JPEG 70 to 75 territory, which is aggressive but produces clean results thanks to the SSIM tuning.

One useful feature of HEIC is the embedded thumbnail. The script generates a 200px preview image stored inside the HEIC container itself, which means Finder and Photos can display a preview without decoding the full resolution image. This makes browsing large photo libraries noticeably faster.

## How the Pipeline Works

**Stage 1: ImageMagick** preprocesses the input into a clean 8-bit PNG intermediate. It auto-orients from EXIF data, flattens transparency to a solid background (HEIC supports alpha through a separate auxiliary image, but that adds significant file size for photo workflows), normalizes to sRGB, caps resolution at 2560px, strips metadata, and forces 8-bit depth. That last part matters: without it, ImageMagick will sometimes write 16-bit PNG from TIFF or HEIC sources, which `heif-enc` would then encode as 10-bit. For 8-bit source material, that just inflates the file with no visual benefit.

**Stage 2: heif-enc** encodes the intermediate PNG into HEIC using the x265 encoder. The preset is set to "slow", which is the sweet spot for still images according to libheif benchmarks. Going slower than "slow" gives negligible compression gains while significantly increasing encode time. The SSIM tuning optimizes for structural similarity, prioritizing how the image looks to human eyes over raw pixel accuracy.

This is wrapped as an Automator Quick Action, so it runs directly from Finder's right-click menu.

## How to Set It Up

### 1. Install Dependencies

```
brew install imagemagick libheif
```

libheif pulls in x265 and libde265 automatically.

### 2. Create the Automator Quick Action

Open Automator and create a new **Quick Action**. Set it to receive **files or folders** in **any application**. Add a **Run Shell Script** action, set the shell to `/bin/bash`, and change "Pass input" to **as arguments**.

Paste the following script:

```bash
#!/bin/bash
#
# HEIC Optimizer - Automator Quick Action / Shell Script
# Converts and compresses images to optimized HEIC via ImageMagick + heif-enc (libheif/x265).
# Outputs: {filename}_optimized.heic in the same directory as input.
#
# Usage:
#   Automator: Receive files as input > Run Shell Script (pass input as arguments)
#   Terminal:  ./optimize_heic.sh file1.jpg file2.png ...
#
# Dependencies:
#   brew install imagemagick libheif
#   (libheif pulls in x265 and libde265 automatically)
#
# Compression pipeline:
#   1. ImageMagick: auto-orient, flatten transparency, sRGB normalize, resize cap,
#      strip metadata > intermediate PNG file (heif-enc cannot read stdin)
#   2. heif-enc:    HEVC (H.265) encoding via x265 with perceptual tuning
#                   HEIC typically achieves 40-50% smaller files than equivalent-quality JPEG.
#
# heif-enc flags explained:
#   -q QUALITY         0-100, maps to x265 CRF internally. 50=default. NOT equivalent to JPEG scale
#                      HEIC q50 ~ JPEG q80-85 perceptually. q40 ~ JPEG q70-75.
#   -p preset=slow     x265 encoder preset. "slow" is optimal for still images per libheif benchmarks
#                      (slower presets give negligible gains; faster presets sacrifice compression)
#   -p tune=ssim       Optimize for structural similarity (perceptual quality). Default in heif-enc
#   -p tu-intra-depth=2  Transform unit recursion depth (default). Good compression/speed balance
#   --no-alpha         Strip alpha channel for photo inputs (saves space; HEIC alpha = separate aux image)
#   -t 200             Generate 200px thumbnail embedded in HEIC container (fast preview in Finder/Photos)
#
# Supported input formats:
#   jpg, jpeg, png, tiff, tif, bmp, webp, heic, heif, avif, gif (first frame only)
#
# Compatibility:
#   HEIC is natively supported on macOS 10.13+, iOS 11+, Windows 10 (with extension), Android 10+.
#   For maximum compatibility, use the JPEG optimizer instead.
#

# --- Configuration -----------------------------------------------------------
QUALITY=40              # heif-enc quality 0-100. 40=aggressive, perceptually ~JPEG 70-75. 50=~JPEG 80-85
PRESET="slow"           # x265 preset. "slow"=optimal for stills. Don't go below; diminishing returns
TUNE="ssim"             # x265 tune. "ssim"=perceptual (default). "grain" for noisy/film sources
THUMB_SIZE=200          # Embedded thumbnail max edge (px). 0=no thumbnail. Speeds up Finder previews
SUFFIX="_optimized"     # Output filename suffix before extension
MAX_DIM=2560            # Cap longest edge in px (0=no resize). 2560=retina 13"
BG_COLOR="white"        # Background for transparent inputs (alpha is stripped for HEIC photo optimization)
STRIP_METADATA=true     # Strip EXIF/IPTC/XMP/ICC via ImageMagick before encoding
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
command -v heif-enc >/dev/null 2>&1 || missing="${missing:+$missing }libheif"
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
    rm -rf "$t" 2>/dev/null
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
  out="${dir}/${base}${SUFFIX}.heic"

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

  # Create temp directory in /tmp (avoids iCloud syncing partial writes)
  # heif-enc cannot read stdin AND uses file extension to detect input format,
  # so we need properly-named intermediate files (BSD mktemp requires X's at end)
  tmp_dir="$(mktemp -d /tmp/.heic_XXXXXX)" || {
    notify "Cannot create temp directory" "Optimization Error"
    fail=$((fail + 1))
    continue
  }
  tmp_png="${tmp_dir}/intermediate.png"
  tmp_heic="${tmp_dir}/output.heic"
  TMP_FILES+=("$tmp_dir")

  # --- Stage 1: ImageMagick preprocessing > intermediate PNG ----------------
  magick_args=("$f")

  # Auto-orient from EXIF rotation data
  magick_args+=(-auto-orient)

  # Flatten transparency to background color
  # HEIC supports alpha via auxiliary image, but it adds significant size.
  # For photo optimization (our primary use case), flatten to solid background.
  # If you need alpha preservation, remove -flatten and remove --no-alpha below.
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

  # Force 8-bit PNG output depth
  # Prevents ImageMagick from writing 16-bit PNG from TIFF/HEIC sources,
  # which heif-enc would then encode as 10-bit (larger, no visual benefit for 8-bit sources)
  magick_args+=(-depth 8)

  # Output as lossless PNG intermediate
  magick_args+=("$tmp_png")

  magick "${magick_args[@]}" 2>/dev/null
  if [ ! -s "$tmp_png" ]; then
    rm -rf "$tmp_dir"
    notify "Preprocessing failed: ${base}.${ext}" "Optimization Error"
    fail=$((fail + 1))
    continue
  fi

  # --- Stage 2: heif-enc HEVC encoding --------------------------------------
  heifenc_args=(
    -q "$QUALITY"
    -p "preset=$PRESET"
    -p "tune=$TUNE"
    -p "tu-intra-depth=2"
    --no-alpha
  )

  # Embedded thumbnail for fast Finder/Photos previews
  if [ "$THUMB_SIZE" -gt 0 ]; then
    heifenc_args+=(-t "$THUMB_SIZE")
  fi

  heifenc_args+=(-o "$tmp_heic" "$tmp_png")

  heif-enc "${heifenc_args[@]}" 2>/dev/null
  if [ ! -s "$tmp_heic" ]; then
    rm -rf "$tmp_dir"
    notify "Encoding failed: ${base}.${ext}" "Optimization Error"
    fail=$((fail + 1))
    continue
  fi

  # Clean up intermediate PNG immediately
  rm -f "$tmp_png"

  # --- Compare sizes and finalize --------------------------------------------
  orig=$(stat -f%z "$f")
  comp=$(stat -f%z "$tmp_heic")

  mv "$tmp_heic" "$out"
  rm -rf "$tmp_dir"

  # Preserve original modification timestamp
  if [ "$PRESERVE_TIMESTAMP" = true ]; then
    touch -r "$f" "$out"
  fi

  if [ "$comp" -lt "$orig" ]; then
    saved=$((orig - comp))
    total_saved=$((total_saved + saved))
    pct=$((saved * 100 / orig))
    notify "${base}: $(human_size "$orig") > $(human_size "$comp") (-${pct}%)" "HEIC Optimized"
  else
    notify "${base}: $(human_size "$comp") (was $(human_size "$orig"))" "HEIC Optimized"
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

Save the Quick Action as "Optimize HEIC" (or whatever you prefer). It will appear when you right-click any file in Finder under Quick Actions.

Select one or more images, right-click, and run it. Each file produces an `_optimized.heic` in the same directory with a macOS notification showing the before/after size and savings percentage.

### Compatibility

HEIC is natively supported on macOS 10.13+, iOS 11+, Windows 10 (with the HEVC extension from the Microsoft Store), and Android 10+. If you need to share images with someone on an older system, the JPEG optimizer is the safer choice.

### Configuration

**QUALITY** controls the x265 encoder's rate factor. The scale is not directly comparable to JPEG: HEIC quality 40 produces results perceptually similar to JPEG quality 70 to 75, and HEIC quality 50 is closer to JPEG quality 80 to 85. The default of 40 is aggressive but holds up well with SSIM tuning enabled.

**PRESET** sets the x265 encoding speed. The default of "slow" is the recommended setting for still images based on libheif benchmarks. Presets slower than "slow" offer negligible compression improvement while taking significantly longer. Faster presets like "medium" or "fast" will encode quicker but produce larger files.

**TUNE** selects the perceptual optimization strategy. The default "ssim" optimizes for structural similarity, which works well for most photos. Switch to "grain" if you are working with noisy or film-scanned images and want to preserve that texture.

**THUMB_SIZE** sets the maximum edge length for the embedded thumbnail. The default of 200px provides fast previews in Finder and Photos without adding much to the file size. Set to 0 to skip thumbnail generation entirely.

**MAX_DIM** caps the longest edge in pixels. The default of 2560 (retina 13") is usually sufficient for viewing and sharing. Set to 0 to skip resizing entirely.

**STRIP_METADATA** removes EXIF, IPTC, XMP, and ICC profile data during the ImageMagick stage. Set to false if you need to preserve camera data or copyright information.

Supported input formats include jpg, jpeg, png, tiff, bmp, webp, heic, heif, avif, and gif (first frame only). Transparent formats are flattened to a white background since the script strips the alpha channel for optimal photo compression.
