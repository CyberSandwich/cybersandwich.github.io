three.js 0.186.1 (MIT) from npm, minified with esbuild 0.28.1; Pages gzips it.
meshoptimizer 1.3.0 decoder (MIT).
Layout mirrors three/examples/jsm so relative imports resolve unchanged; only .min.js files are kept.
Regenerate: ./scripts/vendor-three.sh 0.186.1   (MESHOPT_VERSION=1.3.0)
Importmap: "three" -> build/three.module.min.js; addons import it by that bare name.
