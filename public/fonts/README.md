# Self-hosted reference fonts

MoM serves these sixteen WOFF2 files through [fonts.css](fonts.css) at `/fonts/`. They were extracted byte-for-byte from the [supplied standalone reference](<../../docs/design-reference/Minutes of Meeting (standalone).html>); the app does not load its executable prototype scripts or an external font stylesheet. Reference originals remain unchanged.

| Family | Bundled version / weights | License |
| --- | --- | --- |
| Pretendard Variable | 1.3.9, variable | [SIL OFL 1.1](../licenses/Pretendard-OFL.txt) |
| IBM Plex Mono | Google Fonts v20, 400 / 500 / 600 | [SIL OFL 1.1](../licenses/IBM-Plex-OFL.txt) |

The provenance check recorded on 2026-09-30 byte-matched all sixteen assets against Pretendard's tagged v1.3.9 distribution and the fifteen IBM Plex Mono v20 Google Fonts files. MoM did not subset, rename or modify them. Embedded copyright, version and license strings are preserved in [reference-font-NOTICES.txt](../licenses/reference-font-NOTICES.txt).

Preserve the original notices and license texts when redistributing these fonts. Pretendard and Plex are reserved font names; modifications must follow the applicable OFL reserved-name conditions. Font rights come from those licenses, separately from [MoM's software license](../../LICENSE).
