# Scholar → EndNote / Zotero Export

Chrome (MV3) extension. Select Google Scholar items on **search results, author
profiles, "Cited by" lists, and your saved library**, enrich each citation via
**Crossref → OpenAlex** (title match, year-guarded), and export **one combined
file** in **RIS / EndNote .enw / BibTeX / RefWorks** to a **downloaded file**,
**Zotero** (running connector), or **EndNote** (auto-import via native host).

Runs first-party in your Scholar session, so it does **not** hit the 403 that
kills copied `scholar.enw` export links.

## Install the extension
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open any Scholar page. Each item gets controls + a bar bottom-right
   (**cart count · format · target · Export cart · Clear**).
   - Checkbox = add/remove from a **cross-page cart** (survives pagination).
   - `↓EN` = export that one item immediately.
   - `★` = live journal quality (OpenAlex): h-index / 2yr impact / works / DOAJ,
     colour-tiered. On demand (one API call), not auto on every row.
   - `↓MD` = convert the result's PDF to Markdown (needs host + markitdown, below).

## Journal-quality badges
Two independent sources:
- **Live (★, built in):** OpenAlex source stats by title/ISSN. CC0, nothing to
  install, no bundled data.
- **Bundled lists (optional):** drop `rankings/index.json` + per-list JSON maps
  (`NORMKEY → label`) into the extension for instant badges on every row (SJR,
  ABDC, AJG, …). Build them with `tools\build_rankings.py <Name> <csv>`; keys use
  the same normalization as `content.js`. Inert until present.
  **You supply the data and accept each list's redistribution terms** — AJG/CABS,
  FT50 and ABDC are not freely redistributable; the code is MIT, the data isn't.

## PDF → Markdown (markitdown)
`↓MD` sends the result's PDF URL to the native host, which downloads it, runs
Microsoft **markitdown**, and writes `<title>.md` to your Downloads.
Needs the native host (below) **and** `pip install markitdown`. Only works when
the PDF URL returns an actual PDF (open-access); paywalled landing pages fail
with a clear message.

## Targets
- **Download file** — opens/imports via file association (default).
- **Zotero** — requires Zotero running (connector on `127.0.0.1:23119`); imports directly.
- **EndNote (auto-import)** — requires the native host below.

## Native host (optional, Windows) — enables EndNote auto-import and ↓MD
Needs Python on PATH. ID-free install:

```
python nativehost\install.py
```

(auto-detects the extension ID from Chrome; pass it explicitly if detection
fails: `python nativehost\install.py <EXTENSION_ID>`). Restart Chrome.

- **EndNote auto-import:** host writes a temp `.ris` and `os.startfile`s it, so
  **`.ris` must be associated with EndNote**. Auto-import only removes the manual
  File > Import click; the **Download file** target works without any host, and
  the EndNote target now falls back to a download if the host is absent.
- **↓MD:** also `pip install markitdown`.

## Known limits / maintenance
- **DOM-dependent** selectors (`.gs_r.gs_or.gs_scl`, `data-cid`, profile
  `.gsc_a_tr`). Scholar markup changes → update `content.js` `parseRow`.
- **Enrichment is title-matched.** Guarded by Dice similarity ≥ 0.82 + year ±1,
  but wrong matches are possible; records that miss the threshold fall back to
  Scholar's own hint metadata. The toast reports `enriched` vs `fallback` counts
  — check fallbacks.
- **★ live rating** is one-at-a-time (two OpenAlex calls); not auto on every row,
  to avoid rate limits. Bundled lists are instant but need the data.
- **Bundled-list match** is by normalized venue name only (no ISSN on the Scholar
  page), so venue-name variants can miss.
- No icons yet — add 16/48/128 px + `icons` in `manifest.json` before any store
  submission. Fine for unpacked/dev use.
