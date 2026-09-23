#!/usr/bin/env zsh
# build-photo.sh: derive the Home coin's two faces from their masters
#
# Usage:
#   ./scripts/build-photo.sh                    From website-assets/DS Home Photo.jpeg and DS Home Tails.png
#   ./scripts/build-photo.sh <photo> [<tails>]  From any images (center-cropped to square)
#
# Both faces are 720px square: the coin is at most 240 CSS px (style.css .photo), so 720 covers 3x screens.
# Heads: photo.avif (served) and photo.webp (fallback for browsers without AVIF). Against the resized
# master, AVIF q60 scores a slightly better SSIM than WebP q80 at fewer bytes.
# Tails: tails.png, a 16-level gray PNG8, since the face is flat black-on-white type.

set -euo pipefail
cd "${0:A:h}/.."

src=${1:-"website-assets/DS Home Photo.jpeg"}
tails=${2:-"website-assets/DS Home Tails.png"}
for f in $src $tails; do [[ -f $f ]] || { print -u2 "No such file: $f"; exit 1 }; done
for t in magick avifenc cwebp; do
  command -v $t >/dev/null || { print -u2 "Missing $t (brew install imagemagick libavif webp)"; exit 1 }
done

square=(-auto-orient -resize 720x720^ -gravity center -extent 720x720 -strip)
png=.photo-build.png; trap 'rm -f $png' EXIT
magick "$src" $square $png
avifenc -q 60 -s 4 $png photo.avif >/dev/null
cwebp -quiet -q 80 -m 6 -sharp_yuv $png -o photo.webp
magick "$tails" $square -colorspace Gray -colors 16 PNG8:tails.png
ls -l photo.avif photo.webp tails.png
