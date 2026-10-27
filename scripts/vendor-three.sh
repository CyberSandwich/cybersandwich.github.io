#!/usr/bin/env zsh
# vendor-three.sh: vendor three.js from npm as minified ESM into roundabout/vendor/three
#
# Usage:
#   ./scripts/vendor-three.sh <three-version>     e.g. 0.186.1
#
# npm ships no .min builds, so each file is minified here with esbuild (legal comments kept inline).
# Only .min.js files are kept; this script regenerates them. Layout mirrors three/examples/jsm so
# relative imports resolve unchanged, and every internal import is rewritten to its .min.js sibling.
# The addons import the bare specifier 'three': the page's importmap must map it to build/three.module.min.js.
# The meshoptimizer decoder is pinned apart from three: $MESHOPT_VERSION (default below).
# npm gets its own cache dir: the default ~/.npm can be root-owned.

set -euo pipefail
cd "${0:A:h}/.."

esbuild_version=0.28.1
meshopt_version=${MESHOPT_VERSION:-1.3.0}
three_version=${1:?Usage: vendor-three.sh <three-version>}
out=roundabout/vendor/three
work=$(mktemp -d "${TMPDIR:-/tmp}/vendor-three.XXXXXX")
cache=${VENDOR_THREE_CACHE:-${TMPDIR:-/tmp}/vendor-three-npm}

for t in node npm npx tar; do
  command -v $t >/dev/null || { print -u2 "Missing $t"; exit 1 }
done

# unpack <pkg@version> <dir>: npm pack, then extract so the files sit under <dir>/package
unpack() {
  mkdir -p $2
  (cd $2 && npm pack $1 --silent --cache $cache >/dev/null && tar -xzf *.tgz)
}
unpack three@$three_version $work/three
unpack meshoptimizer@$meshopt_version $work/meshopt

# Files are copied from <src> to <out> under the same relative path, as .min.js
files=(
  $work/three/package/build/three.core.js:build/three.core.min.js
  $work/three/package/build/three.module.js:build/three.module.min.js
  $work/three/package/examples/jsm/loaders/GLTFLoader.js:addons/loaders/GLTFLoader.min.js
  $work/three/package/examples/jsm/utils/BufferGeometryUtils.js:addons/utils/BufferGeometryUtils.min.js
  $work/three/package/examples/jsm/utils/SkeletonUtils.js:addons/utils/SkeletonUtils.min.js
  $work/meshopt/package/meshopt_decoder.mjs:addons/libs/meshopt_decoder.min.js
)

rm -f $out/build/*.js $out/addons/*/*.js
mkdir -p $out/build $out/addons/loaders $out/addons/utils $out/addons/libs

for pair in $files; do
  src=${pair%%:*} dest=$out/${pair#*:}
  [[ -f $src ]] || { print -u2 "Missing $src in the npm package"; exit 1 }
  npx --cache $cache --yes --loglevel=error esbuild@$esbuild_version $src --minify --format=esm --legal-comments=inline \
    --log-level=warning --outfile=$dest
  # esbuild minifies to double-quoted specifiers; the trailing lookahead-free pattern only touches relative .js imports
  sed -E -i '' 's#((from|import)[[:space:]]*")(\.[^"]*)\.js"#\1\3.min.js"#g' $dest
done

cp $work/three/package/LICENSE $out/LICENSE
cp $work/meshopt/package/LICENSE.md $out/addons/libs/meshopt-LICENSE.md
rm -rf $work/three $work/meshopt
rmdir $work

cat > roundabout/vendor/README.txt <<EOF
three.js $three_version (MIT) from npm, minified with esbuild $esbuild_version; Pages gzips it.
meshoptimizer $meshopt_version decoder (MIT).
Layout mirrors three/examples/jsm so relative imports resolve unchanged; only .min.js files are kept.
Regenerate: ./scripts/vendor-three.sh $three_version   (MESHOPT_VERSION=$meshopt_version)
Importmap: "three" -> build/three.module.min.js; addons import it by that bare name.
EOF

for f in $out/build/*.js $out/addons/*/*.js; do
  print "$(wc -c < $f) $(gzip -9c $f | wc -c) $f"
done
