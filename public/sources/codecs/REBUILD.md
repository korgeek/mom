# Pinned MP3 codec source and relinking materials

These packages preserve the published source and build inputs for MoM's pinned MP3 encoder and decoder. They accompany the license texts in `/licenses/`. They do not claim an Emscripten source rebuild or behavior-changing library build; the recorded object replacement is metadata-only. `SOURCE_MANIFEST.json` records release metadata, source pins, hashes, exact comparisons, archive inventory and remaining verification limits.

| Distributed component | Published source | Library source | Declared build tools |
| --- | --- | --- | --- |
| `wasm-media-encoders` 0.7.0, standalone MP3 WASM | `arseneyr/wasm-media-encoders` commit `4a45333baadbab312d1cc0911151dfad23157c51` | LAME 3.100 fork, `arseneyr/lame` commit `98db548e8e851defbba3184125ce10725355c332` | Emscripten 2.0.8, Node 20, Yarn 4.1.1 |
| `mpg123-decoder` 1.0.3, WASM embedded in `src/EmscriptenWasm.js` | `eshaz/wasm-audio-decoders` npm release commit `8f2428c1cd96b54dab74836c8471ff75fe35cbee` | mpg123 1.29.0, `madebr/mpg123` commit `08247b317163175e62035893af3ff9e71a5dfefd` | Emscripten 4.0.7, Node >=18, Linux-like environment, GNU make and autoreconf prerequisites |

The encoder binary matches the integrity-verified npm release tarball and contains the strings `3.100` and `wasm-media-encoders-0.7.0`. The decoder's generated module matches both its verified npm release tarball and the exact npm release commit. The decoder's embedded WASM validates, but has no surviving mpg123 version string: its 1.29.0 version is established by the pinned source's `configure.ac`. Both binaries lack producer/version custom sections. Exact compiler execution provenance or bit-for-bit rebuild equivalence is therefore not asserted.

## Downloads and contents

- `wasm-media-encoders-0.7.0-mp3-source.tar.gz`: original wrapper C/TypeScript, Makefile, minification graph, version/configuration files, lockfile, dev-container configuration and the complete pinned LAME submodule, including its own small test assets. Unused Ogg/Vorbis submodules, the wrapper's fixture corpus, dependency caches and generated editor tooling are omitted. Every original source file included is unchanged. The MP3 target below avoids the omitted codec builds. A clearly labeled MoM recipe addition, `REBUILD-MP3.sh`, is also supplied.
- `mpg123-decoder-1.0.3-source.tar.gz`: original mpg123/common wrapper code, generated decoder module, C glue/headers, Emscripten pre/post scripts, build/minification configuration, root/package lockfiles, Makefile and the complete pinned mpg123 submodule, including its own small test assets. Other decoder package metadata needed by the original npm dependency graph is present; unused codecs, their generated binaries, source maps and the wrapper repository's large fixture corpus are omitted. Use the targeted mpg123 commands below rather than the root all-codec targets.
- Each archive contains `SOURCE_FILES.json` with hashes for its source files and `SOURCE_PACKAGE.txt` describing the packaging exclusions. Toolchain/compiler binaries and dependency caches are not included.

## Encoder build

Use the upstream declared environment from the archived `.devcontainer/devcontainer.json`, or an equivalent Linux build environment with Emscripten 2.0.8 installed at `/emsdk`. The original Makefile invokes `/emsdk/upstream/bin/wasm-metadce` by absolute path. Node 20 must precede the SDK's Node 12 in `PATH`, as the upstream README specifies. Yarn 4.1.1 is recorded in the original `packageManager2` field; that nonstandard field does not automatically pin a Corepack invocation.

After extracting the archive and entering its top-level directory:

```sh
source /emsdk/emsdk_env.sh
# Select Node 20 in this build environment, with Node 20 before SDK Node in PATH.
corepack enable
corepack prepare yarn@4.1.1 --activate
yarn install --immutable
make wasm-prod wasm_output=mp3.wasm
```

This original target configures the supplied LAME tree with decoder/frontend disabled, builds static `libmp3lame.a`, links the supplied `lame_enc.c` glue with `-Oz -flto`, and runs the supplied minification graph. The output is `wasm/mp3.wasm`. The complete LAME tree includes the fork's changes and its original copyright/license notices; no MoM patch has been applied to it.

The current macOS host has GNU Make 3.81. Its dry run selects the upstream broad directory rule and prints directory/copy commands instead of the intended compiler chain, so that host/command combination has not been validated. `REBUILD-MP3.sh` is an explicitly labeled MP3-only shell transcription of the upstream configure/link/minification recipe. It keeps the flags, C glue, version value and library source unchanged and avoids that wrapper Makefile pattern-rule resolution. It reads the same package name/version directly with Node instead of requiring the TypeScript/Yarn version-print helper. From the extracted source root, with the declared SDK available, use:

```sh
bash REBUILD-MP3.sh --dry-run
bash REBUILD-MP3.sh
```

Only shell syntax, source-input existence and the printed recipe have been checked. The script has not executed a compiler build. Its source is included in the archive and its own publication permission is part of the parent release owner's MoM grant gate.

Keep the glue's export ABI when replacing the library. Rebuilding only the MP3 asset does not require regenerating the unchanged MIT JavaScript wrapper. Building the upstream package's complete all-format wrapper requires its additional Ogg/Vorbis submodules, which are recorded in the original `.gitmodules` but are not shipped or claimed by this source package.

## Decoder build and embedding

Provide a Linux-like environment with Emscripten 4.0.7, Node >=18, GNU make, autoconf, automake and libtool prerequisites. The upstream README does not pin the exact GNU tool or Node minor versions. The complete mpg123 tree includes its Autoconf templates, `m4/`, headers and scripts, so its generated configuration can be recreated. The original Makefile's `mpg123-configure` target appends `#define NOQUIET 0` to the generated `modules/mpg123/src/config.h`, with a comment explaining unused debug-code stripping. This configuration step is included unchanged; it must not be omitted when reproducing the published recipe.

After extracting the archive and entering its top-level directory:

```sh
source /path/to/emsdk-4.0.7/emsdk_env.sh
npm ci
# Dependencies for the selected wrapper are installed without invoking all codecs.
npm ci --prefix src/mpg123-decoder
mkdir -p demo
make mpg123-configure
make mpg123-decoder
```

The original target directly compiles the thirteen listed `src/libmpg123/*.c` files into `tmp/mpg123.o`, links `mpeg_frame_decoder.c` and the supplied pre/post scripts, and emits `src/mpg123-decoder/src/EmscriptenWasm.tmp.js`. The supplied `build.js` and Makefile then compress the WASM with the declared Zopfli iteration count, encode it with `simple-yenc`, and write `src/mpg123-decoder/src/EmscriptenWasm.js`. They also produce the package's bundled/minified decoder outputs. Merely replacing a standalone `.wasm` file would not replace this embedded decoder.

If changing a compiled C source after an earlier build, remove the stale `tmp/mpg123.o` and `src/mpg123-decoder/src/EmscriptenWasm.tmp.js` before running the target again: the original object rule has no C-file prerequisites. If changing the common puff decompressor, its complete `puff.c`, `puff.h`, README and `build_puff.js` are included, and the separate original `make puff` target regenerates its common wrapper representation. The supplied puff notices cover this additional embedded WASM component.

## Replace codecs in the delivered objects without MoM source

MoM's application TypeScript remains private. These source packages contain the preferred source for the statically combined codec C code and its MIT glue, plus the public decoder/common wrapper code. The delivered JavaScript Worker is available as object material; the LGPL section 6(a) option refers to object code and/or source for the work using the library, so supplying the entire independent application's TypeScript is not assumed necessary here.

For the encoder, replace the delivered standalone MP3 `.wasm` asset in an own-use copy of the public application assets while retaining its expected URL and export ABI. The Worker loads that same-origin asset dynamically. It does not embed the encoder's library bytes into its JavaScript object. This source package contains all the library/glue code statically combined inside that WASM module.

For the decoder, merely replacing a standalone `.wasm` file or `dist/mpg123-decoder.min.js` does not alter the delivered Worker. Its payload is compressed and encoded inside a `String.raw` template. The supplied `relink-decoder.mjs` utility replaces exactly that literal using the generated decoder module's rebuilt WASM payload. It needs Node >=18 and the included vendor files, with no npm install or MoM TypeScript. Acorn 8.16.0 and simple-yenc 1.0.4 are copied verbatim alongside their full MIT licenses.

Download the delivered Worker JavaScript object and obtain its expected SHA256 from the reviewed release metadata. Extract the pinned baseline `src/mpg123-decoder/src/EmscriptenWasm.js` from the source archive, and build the modified decoder as above. Calculate and review the new generated module's SHA256, then use:

```sh
node relink-decoder.mjs \
  --worker worker-original.js \
  --expected-worker-sha256 REVIEWED_WORKER_SHA256 \
  --baseline-module mpg123-decoder-1.0.3-source/src/mpg123-decoder/src/EmscriptenWasm.js \
  --expected-baseline-module-sha256 8049f11cca486999538aa1b296ad18508d49d182a16cd6e1835f00148075db1a \
  --replacement-module rebuilt-EmscriptenWasm.js \
  --expected-replacement-module-sha256 REVIEWED_REBUILT_MODULE_SHA256 \
  --output worker-relinked.js
```

The utility verifies all three input hashes before parsing, finds one exact baseline payload match, validates/decompresses the replacement WASM, and checks the supported import/export descriptor compatibility including imported/exported function parameters and results. It parses code with Acorn and never evaluates or imports the supplied JavaScript. It changes only the decoder's tagged-template expression and validates the output before creating a new file exclusively. Missing/multiple matches, wrong hashes, invalid WASM, signature mismatches, unsupported ABI features and existing output paths fail closed.

This route preserves the current JavaScript wrapper. Changes to regenerated JavaScript glue are not installed by the utility. Modified codec builds must retain that wrapper's supported ABI; a build requiring different glue/imports is outside this replacement route. Exported memory/table descriptors permit compatible increases in initial capacity. The descriptor checks do not guarantee identical runtime behavior or validate every possible WASM feature; globals, tags, GC/reference-type extensions and memory64 ABIs are rejected rather than assumed compatible. Recipients must test the modified codec's behavior.

Serve the relinked Worker under the original Worker asset URL in a local own-use copy of the delivered app objects, alongside its other original assets and the desired encoder asset. This avoids needing the application's private source or changing its security policy. Test WAV/MP3 preparation using that object set. Nothing in this utility publishes an application copy or uploads/transmits audio.

The recorded test proves an unchanged actual delivered Worker roundtrip and replacement of valid WASM with a metadata-only custom-section addition. It does not constitute a compiler rebuild, changed-C behavior test or blanket legal-compliance finding. Original production objects are preserved. The user-approved recipient modification/debugging permission is included as described below; no new whole-app license is assigned by these instructions.

## License and publication conditions

LAME's supplied `COPYING` is GNU Library GPL version 2; the relevant source headers permit version 2 or later. mpg123's supplied `COPYING` contains LGPL 2.1 and complete GPL 2 texts, along with its copyright message. The decoder's compiled library files identify LGPL 2.1. Both libraries are statically combined with their C glue inside their respective WASM modules. The JavaScript integration and separate asset boundaries do not make that static combination disappear.

Under both supplied licenses, sections 4–6 address corresponding source, linked works, and relinking. Section 6(a) requires the library source (including changes) and the source and/or object material for the work using it, so recipients can produce a modified executable. Equivalent access from the same download location is the option in GNU Library GPL 2 section 6(c) for LAME, and LGPL 2.1 section 6(d) for mpg123; section 4 of each license also addresses same-location library source access. The licensing conditions require the applicable notices/full license and terms permitting modification for recipients' own use and reverse engineering to debug those modifications. The codec source/glue plus delivered Worker object and the narrowly supported payload replacement path provide technical material for the object-code option; they do not establish legal certainty about every combination boundary. The approved MoM-specific own-use modification/debugging permission remains unchanged at [/licenses/MoM-OBJECT-PERMISSION.txt](/licenses/MoM-OBJECT-PERMISSION.txt). The [MoM Source Available License 1.0](/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt) separately covers MoM-owned application software and preserves LGPL and existing recipient rights. Only the two dedicated helpers remain MIT under [/licenses/MoM-CODEC-HELPERS-MIT.txt](/licenses/MoM-CODEC-HELPERS-MIT.txt). These codec materials do not publish the application's TypeScript or change repository visibility.

Full texts are available in `/licenses/lame-3.100-COPYING.txt`, `/licenses/lame-3.100-LICENSE.txt`, `/licenses/mpg123-1.29.0-COPYING.txt` and `/licenses/GPL-2.0.txt`. The original wrapper MIT license, materialized standard MIT terms for the decoder/common project, puff notice, and Emscripten/musl notices are also available there. The standard MIT terms are sourced from SPDX and paired with the actual decoder copyright notice because that upstream repository declares MIT in its README/package metadata but has no standalone LICENSE file; this provenance is explicit in `SOURCE_MANIFEST.json`.

Primary source references:

- [Encoder source and original build file](https://github.com/arseneyr/wasm-media-encoders/tree/4a45333baadbab312d1cc0911151dfad23157c51)
- [Pinned LAME fork source and COPYING](https://github.com/arseneyr/lame/tree/98db548e8e851defbba3184125ce10725355c332)
- [Decoder release source, original build scripts and MIT declaration](https://github.com/eshaz/wasm-audio-decoders/tree/8f2428c1cd96b54dab74836c8471ff75fe35cbee)
- [Pinned mpg123 source and COPYING](https://github.com/madebr/mpg123/tree/08247b317163175e62035893af3ff9e71a5dfefd)
- [Standard MIT license text, SPDX v3.27.0](https://github.com/spdx/license-list-data/blob/v3.27.0/text/MIT.txt)
- [Official complete GPL 2 text](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt)
