#!/usr/bin/env zsh
# build-roundabout-assets.sh: rebuild /roundabout/assets (models, tex, signs) from the upstream sources
#
# Usage:
#   ./scripts/build-roundabout-assets.sh [models|tex|signs ...]    No argument builds all three
#
# Sources (licences and authors are in roundabout/assets/CREDITS.md):
#   models  Grab3D GLBs (CC0), normalized and slimmed by scripts/lib/roundabout-models.mjs
#   tex     Poly Haven 1k diffuse JPGs (CC0), resized to 512 webp (the asphalt is drawn at runtime by world.js)
#   signs   gov.uk traffic-sign-images JPG zips (OGL v3), white ground keyed out, 256 px webp
# Downloads and the npm toolchain are cached in $ROUNDABOUT_CACHE (default $TMPDIR/roundabout-assets);
# delete it to refetch. Downloaded files are only parsed or converted, never executed.
# npm gets its own cache dir: the default ~/.npm can be root-owned.

set -euo pipefail
cd "${0:A:h}/.."

cache=${ROUNDABOUT_CACHE:-${TMPDIR:-/tmp}/roundabout-assets}
out=roundabout/assets
steps=($@)
(( $#steps )) || steps=(models tex signs)

for t in curl node npm magick cwebp unzip; do
  command -v $t >/dev/null || { print -u2 "Missing $t (brew install curl node imagemagick webp unzip)"; exit 1 }
done

fetch() {  # fetch <url> <dest>: skips files already cached
  [[ -s $2 ]] || curl -fsSL --retry 2 -m 120 "$1" -o "$2"
}

# grab3d <slug> <dir>: the light GLB when the model has one (its manifest lists triangles_light), else the full one
grab3d() {
  local variant=$1
  curl -fsSL --retry 2 -m 60 https://grab3d.com/dl/$1/manifest.json | grep -q '"triangles_light": null' || variant=$1-light
  fetch https://grab3d.com/dl/$1/$variant.glb $2/$1.glb
}

build_models() {
  local tools=$cache/tools src=$cache/grab3d slug
  if [[ ! -d $tools/node_modules/sharp ]]; then
    mkdir -p $tools
    print '{"private":true}' > $tools/package.json
    npm install --prefix $tools --cache $cache/npm --no-audit --no-fund \
      @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 \
      meshoptimizer@1.3.0 sharp@0.35.5
  fi
  mkdir -p $src $out/models
  for slug in $(node scripts/lib/roundabout-models.mjs --slugs); do
    grab3d $slug $src
  done
  node scripts/lib/roundabout-models.mjs $tools $src $out/models >/dev/null
}

# id -> output name; a texture's page is https://polyhaven.com/a/<id>
typeset -A textures=(grass_ground grass concrete_pavement_02 pavement red_brick_03 brick)

webp512() {  # webp512 <in.jpg> <out.webp>
  magick $1 -resize 512x512! -strip png:- | cwebp -quiet -q 80 -m 6 -o $2 -- -
}

build_tex() {
  local dl=$cache/polyhaven id
  mkdir -p $dl $out/tex
  for id in ${(k)textures}; do
    fetch https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/$id/${id}_diff_1k.jpg $dl/$id.jpg
    webp512 $dl/$id.jpg $out/tex/$textures[$id].webp
  done
}

# Keys out the white ground by flood fill from a white frame around the image; the sign's own white
# (the give-way face, arrows) is enclosed by its border, so the fill never reaches it.
build_signs() {
  local dl=$cache/govuk name file
  mkdir -p $dl $out/signs
  fetch https://assets.publishing.service.gov.uk/media/5a7ef66e40f0b62305b8445e/warning-signs-jpg.zip $dl/warning.zip
  fetch https://assets.publishing.service.gov.uk/media/5a7e23d9e5274a2e8ab4617d/regulatory-signs-jpg.zip $dl/regulatory.zip
  mkdir -p $dl/jpg
  unzip -q -j -o $dl/warning.zip 510.jpg -d $dl/jpg
  unzip -q -j -o $dl/regulatory.zip '*/602.jpg' '*/611.1.jpg' -d $dl/jpg
  for name in 510 602 611.1; do
    file=$dl/jpg/$name.jpg
    [[ -f $file ]] || { print -u2 "Missing $name.jpg in the gov.uk zips"; exit 1 }
    magick $file -resize 252x252 -bordercolor white -border 2 -alpha set -fuzz 12% -fill none \
      -floodfill +0+0 white -strip png:- | cwebp -quiet -q 90 -alpha_q 90 -o $out/signs/${name/./_}.webp -- -
  done
}

for s in $steps; do
  (( $+functions[build_$s] )) || { print -u2 "Unknown step: $s (models, tex, signs)"; exit 1 }
  build_$s
done
du -ch $out/models/*.glb $out/tex/*.webp $out/signs/*.webp | tail -1
