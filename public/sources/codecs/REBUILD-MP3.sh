#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# MIT License
#
# Copyright (c) 2026 MoM contributors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
# End of dedicated helper license. Third-party source keeps its original terms.
# MoM build-recipe addition, 2026-09-30. This is not an upstream file.
# MP3-only transcription of wasm-media-encoders v0.7.0's configure/link/minify
# recipe. Upstream library and wrapper source files remain unchanged.
# No executed compiler build or byte-for-byte reproduction is claimed.
set -euo pipefail

codec_recipe_dry_run=0
case "${1-}" in
  --dry-run) codec_recipe_dry_run=1 ;;
  "") ;;
  *) printf 'Usage: REBUILD-MP3.sh [--dry-run]\n' >&2; exit 2 ;;
esac

codec_recipe_root="$PWD"
for codec_recipe_input in package.json src/wasm/common_params.h src/wasm/lame/lame_enc.c src/wasm/minify_graph.json src/wasm/lame/lame-src/configure; do
  test -f "$codec_recipe_input" || { printf 'Run this script from the extracted encoder source root; missing %s\n' "$codec_recipe_input" >&2; exit 1; }
done
codec_recipe_version="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); process.stdout.write(`${p.name}-${p.version}`)')"
codec_recipe_lame="$codec_recipe_root/src/wasm/lame/lame-src"
codec_recipe_lame_build="$codec_recipe_lame/build"
codec_recipe_build="$codec_recipe_root/src/wasm/build"

codec_recipe_run() {
  if (( codec_recipe_dry_run )); then
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

codec_recipe_run mkdir -p "$codec_recipe_lame_build" "$codec_recipe_build" "$codec_recipe_root/wasm"
if (( codec_recipe_dry_run )); then
  printf 'cd %q\n' "$codec_recipe_lame_build"
else
  cd "$codec_recipe_lame_build"
fi
codec_recipe_run env CFLAGS='-DNDEBUG -DNO_STDIO -Oz -flto' LDFLAGS='-Oz -flto' \
  emconfigure "$codec_recipe_lame/configure" \
  --prefix="$codec_recipe_lame_build" \
  --disable-dependency-tracking --disable-shared --disable-gtktest \
  --disable-analyzer-hooks --disable-decoder --disable-frontend
codec_recipe_run emmake make -j8
codec_recipe_run emmake make install
if (( codec_recipe_dry_run )); then
  printf 'cd %q\n' "$codec_recipe_root"
else
  cd "$codec_recipe_root"
fi
codec_recipe_run emcc \
  "$codec_recipe_lame_build/lib/libmp3lame.a" \
  "$codec_recipe_root/src/wasm/lame/lame_enc.c" \
  -DNDEBUG "-DNODE_PACKAGE_VERSION=\"$codec_recipe_version\"" '-DMIME_TYPE="audio/mpeg"' \
  -Oz -flto -Wl,--strip-all "-I$codec_recipe_lame_build/include" \
  --no-entry -s MALLOC=emmalloc -s ALLOW_MEMORY_GROWTH \
  -s STANDALONE_WASM -s NO_SUPPORT_ERRNO \
  -o "$codec_recipe_build/mp3_full.wasm"
codec_recipe_run /emsdk/upstream/bin/wasm-metadce \
  --graph-file "$codec_recipe_root/src/wasm/minify_graph.json" \
  -o "$codec_recipe_build/mp3.wasm" "$codec_recipe_build/mp3_full.wasm"
codec_recipe_run rm "$codec_recipe_build/mp3_full.wasm"
codec_recipe_run cp "$codec_recipe_build/mp3.wasm" "$codec_recipe_root/wasm/mp3.wasm"
