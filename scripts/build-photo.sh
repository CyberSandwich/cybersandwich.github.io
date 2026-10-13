#!/usr/bin/env zsh
# build-photo.sh: derive the Home coin's photo face from its master (the back is /qr-homepage.png, drawn by CSS)
#
# Usage:
#   ./scripts/build-photo.sh          From website-assets/DS Home Photo.jpeg
#   ./scripts/build-photo.sh <photo>  From any image (center-cropped to square)
#
# The face is 720px square: the coin is at most 240 CSS px (style.css .photo), so 720 covers 3x screens.
# photo.avif (served) and photo.webp (fallback for browsers without AVIF). Against the resized
# master, AVIF q60 scores a slightly better SSIM than WebP q80 at fewer bytes.

set -euo pipefail
cd "${0:A:h}/.."

src=${1:-"website-assets/DS Home Photo.jpeg"}
[[ -f $src ]] || { print -u2 "No such file: $src"; exit 1 }
for t in magick avifenc cwebp; do
  command -v $t >/dev/null || { print -u2 "Missing $t (brew install imagemagick libavif webp)"; exit 1 }
done

png=.photo-build.png; trap 'rm -f $png' EXIT
magick "$src" -auto-orient -resize 720x720^ -gravity center -extent 720x720 -strip $png
avifenc -q 60 -s 4 $png photo.avif >/dev/null
cwebp -quiet -q 80 -m 6 -sharp_yuv $png -o photo.webp
ls -l photo.avif photo.webp
