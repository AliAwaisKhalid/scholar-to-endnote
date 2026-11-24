// Scholar -> EndNote/Zotero Export : service worker (enrichment + emit + deliver)

const MIME = {
  ris: "application/x-research-info-systems",
  enw: "application/x-endnote-refer",
  bib: "application/x-bibtex",
  rfw: "text/plain",
};
const EXT = { ris: "ris", enw: "enw", bib: "bib", rfw: "txt" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- title matching -----------------------------------------------------
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function dice(a, b) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

// ---- enrichment sources -------------------------------------------------
const CR_TYPE = {
  "journal-article": "JOUR", "proceedings-article": "CPAPER", "book-chapter": "CHAP",
  "book": "BOOK", "monograph": "BOOK", "report": "RPRT", "dissertation": "THES",
  "posted-content": "GEN", "dataset": "DATA",
};

function fromCrossref(it) {
  const dp = (it.issued && it.issued["date-parts"] && it.issued["date-parts"][0]) || [];
  return {
    ty: CR_TYPE[it.type] || "GEN",
    title: (it.title && it.title[0]) || "",
    authors: (it.author || []).map((a) => ({ family: a.family || "", given: a.given || "" })),
    year: dp[0] ? String(dp[0]) : "",
    journal: (it["container-title"] && it["container-title"][0]) || "",
    volume: it.volume || "", issue: it.issue || "", pages: it.page || "",
    doi: it.DOI || "", publisher: it.publisher || "",
    url: it.DOI ? "https://doi.org/" + it.DOI : it.URL || "",
  };
}
function fromOpenAlex(w) {
  const loc = w.primary_location || {};
  const src = loc.source || {};
  const bib = w.biblio || {};
  return {
    ty: w.type === "article" ? "JOUR" : "GEN",
    title: w.title || w.display_name || "",
    authors: (w.authorships || []).map((a) => {
      const n = (a.author && a.author.display_name) || "";
      const i = n.lastIndexOf(" ");
      return i > 0 ? { family: n.slice(i + 1), given: n.slice(0, i) } : { family: n, given: "" };
    }),
    year: w.publication_year ? String(w.publication_year) : "",
    journal: src.display_name || "",
    volume: bib.volume || "", issue: bib.issue || "",
    pages: bib.first_page ? bib.first_page + (bib.last_page ? "-" + bib.last_page : "") : "",
    doi: (w.doi || "").replace(/^https?:\/\/doi\.org\//, ""),
    publisher: src.host_organization_name || "",
    url: w.doi || (w.ids && w.ids.openalex) || "",
  };
}

// fetch JSON with 429/503 backoff. Browsers forbid setting User-Agent, and we
// deliberately send no mailto (no user PII), so we live in the anonymous pool.
async function jget(u, tries) {
  tries = tries || 3;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (r.status === 429 || r.status === 503) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}

// Use title + first author + year as a RANKING signal in the query (the version
// of record is often not in the top 5 for a reprinted title).
function queryStr(hint) {
  return [hint.title, (hint.authors || "").split(/[,;]/)[0] || "", hint.year || ""]
    .filter(Boolean).join(" ");
}

async function tryCrossref(hint) {
  const u = "https://api.crossref.org/works?rows=20&select=DOI,title,author,issued,container-title,volume,issue,page,type,publisher,URL&query.bibliographic=" + encodeURIComponent(queryStr(hint));
  const j = await jget(u);
  if (!j) return null;
  return pickBest(((j.message || {}).items || []).map(fromCrossref), hint.title, hint.year);
}
async function tryOpenAlex(hint) {
  const u = "https://api.openalex.org/works?per-page=20&filter=title.search:" + encodeURIComponent(hint.title);
  const j = await jget(u);
  if (!j) return null;
  return pickBest((j.results || []).map(fromOpenAlex), hint.title, hint.year);
}

// Prefer the published version: journal-article/book/proceedings over working
// papers (report) and preprints (posted-content -> GEN).
const TYPE_BONUS = { JOUR: 0.15, CPAPER: 0.1, CHAP: 0.1, BOOK: 0.1, THES: 0.05, RPRT: 0, DATA: 0, GEN: 0 };
function pickBest(recs, title, year) {
  let best = null, bestScore = 0;
  for (const c of recs) {
    const sim = dice(title, c.title);
    if (sim < 0.82) continue; // title gate
    let yb = 0; // year is a soft signal (online-first can be -1), never a hard kill
    if (year && c.year) { const d = Math.abs(+c.year - +year); yb = d === 0 ? 0.4 : d === 1 ? 0.15 : 0; }
    const s = sim + yb + (TYPE_BONUS[c.ty] || 0);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

// Scholar-hint fallback record (no enrichment hit)
function fromHint(it) {
  const auth = (it.authors || "").split(/,|;/).map((s) => s.trim()).filter(Boolean)
    .map((n) => {
      const i = n.lastIndexOf(" ");
      return i > 0 ? { family: n.slice(i + 1), given: n.slice(0, i) } : { family: n, given: "" };
    });
  return { ty: "GEN", title: it.title || "", authors: auth, year: it.year || "",
    journal: "", volume: "", issue: "", pages: "", doi: "", publisher: "", url: "" };
}

// ---- format generators --------------------------------------------------
function authName(a) { return a.family + (a.given ? ", " + a.given : ""); }

function toRIS(r) {
  const L = ["TY  - " + r.ty, "TI  - " + r.title];
  r.authors.forEach((a) => L.push("AU  - " + authName(a)));
  if (r.year) L.push("PY  - " + r.year);
  if (r.journal) L.push("JO  - " + r.journal);
  if (r.volume) L.push("VL  - " + r.volume);
  if (r.issue) L.push("IS  - " + r.issue);
  if (r.pages) { const p = r.pages.split(/[-–]/); L.push("SP  - " + p[0]); if (p[1]) L.push("EP  - " + p[1]); }
  if (r.publisher) L.push("PB  - " + r.publisher);
  if (r.doi) L.push("DO  - " + r.doi);
  if (r.url) L.push("UR  - " + r.url);
  L.push("ER  - ");
  return L.join("\r\n");
}
const ENW_TYPE = { JOUR: "Journal Article", CPAPER: "Conference Paper", CHAP: "Book Section", BOOK: "Book", RPRT: "Report", THES: "Thesis", DATA: "Dataset", GEN: "Generic" };
function toENW(r) {
  const L = ["%0 " + (ENW_TYPE[r.ty] || "Generic"), "%T " + r.title];
  r.authors.forEach((a) => L.push("%A " + authName(a)));
  if (r.year) L.push("%D " + r.year);
  if (r.journal) L.push("%J " + r.journal);
  if (r.volume) L.push("%V " + r.volume);
  if (r.issue) L.push("%N " + r.issue);
  if (r.pages) L.push("%P " + r.pages);
  if (r.publisher) L.push("%I " + r.publisher);
  if (r.doi) L.push("%R " + r.doi);
  if (r.url) L.push("%U " + r.url);
  return L.join("\r\n");
}
function bibKey(r) {
  const fam = (r.authors[0] && r.authors[0].family) || "ref";
  const w = (norm(r.title).split(" ")[0] || "");
  return (fam + r.year + w).replace(/[^A-Za-z0-9]/g, "");
}
function toBib(r) {
  const f = [];
  f.push("title={" + r.title + "}");
  if (r.authors.length) f.push("author={" + r.authors.map(authName).join(" and ") + "}");
  if (r.year) f.push("year={" + r.year + "}");
  if (r.journal) f.push("journal={" + r.journal + "}");
  if (r.volume) f.push("volume={" + r.volume + "}");
  if (r.issue) f.push("number={" + r.issue + "}");
  if (r.pages) f.push("pages={" + r.pages.replace(/-/, "--") + "}");
  if (r.publisher) f.push("publisher={" + r.publisher + "}");
  if (r.doi) f.push("doi={" + r.doi + "}");
  const type = r.ty === "BOOK" ? "book" : r.ty === "CHAP" ? "incollection" : r.ty === "CPAPER" ? "inproceedings" : "article";
  return "@" + type + "{" + bibKey(r) + ",\n  " + f.join(",\n  ") + "\n}";
}
function toRFW(r) {
  const L = ["RT " + (ENW_TYPE[r.ty] || "Generic"), "T1 " + r.title];
  r.authors.forEach((a) => L.push("A1 " + authName(a)));
  if (r.year) L.push("YR " + r.year);
  if (r.journal) L.push("JF " + r.journal);
  if (r.volume) L.push("VO " + r.volume);
  if (r.issue) L.push("IS " + r.issue);
  if (r.pages) L.push("SP " + r.pages);
  if (r.doi) L.push("DO " + r.doi);
  return L.join("\r\n");
}
const GEN = { ris: toRIS, enw: toENW, bib: toBib, rfw: toRFW };

// ---- delivery -----------------------------------------------------------
async function toZotero(risBody) {
  const r = await fetch("http://127.0.0.1:23119/connector/import", {
    method: "POST",
    headers: { "Content-Type": "application/x-research-info-systems" },
    body: risBody,
  });
  if (!r.ok) throw new Error("Zotero returned " + r.status + " (is Zotero running?)");
}
function toEndNoteNative(risBody) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(
        "com.endnote_import.host",
        { format: "ris", data: risBody },
        (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (resp && resp.ok) resolve();
          else reject(new Error((resp && resp.error) || "native host error"));
        }
      );
    } catch (e) { reject(e); }
  });
}
async function download(body, fmt) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dataUrl = "data:" + MIME[fmt] + ";charset=utf-8," + encodeURIComponent(body);
  await chrome.downloads.download({ url: dataUrl, filename: "scholar-" + ts + "." + EXT[fmt], saveAs: false });
}

// ---- main ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "export") return;
  (async () => {
    const fmt = GEN[msg.fmt] ? msg.fmt : "ris";
    const records = [];
    let enriched = 0, fallback = 0;

    for (const it of msg.items) {
      let rec = null;
      try { rec = (await tryCrossref(it)) || (await tryOpenAlex(it)); }
      catch (e) { /* network hiccup -> fallback */ }
      if (rec) enriched++; else { rec = fromHint(it); fallback++; }
      records.push(rec);
      if (msg.items.length > 1) await sleep(800); // spacing to avoid API 429s
    }
    if (!records.length) { sendResponse({ ok: false, error: "no records" }); return; }

    const body = records.map(GEN[fmt]).join("\r\n\r\n") + "\r\n";
    const risBody = records.map(toRIS).join("\r\n\r\n") + "\r\n";

    const base = { done: records.length, enriched, fallback };
    try {
      if (msg.target === "zotero") {
        await toZotero(risBody);
        sendResponse({ ok: true, ...base, note: "sent to Zotero" });
      } else if (msg.target === "endnote") {
        try {
          await toEndNoteNative(risBody);
          sendResponse({ ok: true, ...base, note: "sent to EndNote" });
        } catch (e) {
          await download(risBody, "ris"); // never dead-end: save the file instead
          sendResponse({ ok: true, ...base, note: "EndNote host not installed — downloaded .ris instead (run nativehost\\install.py once to enable auto-import)" });
        }
      } else {
        await download(body, fmt);
        sendResponse({ ok: true, ...base, note: "downloaded — open it to import" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || "delivery failed", ...base });
    }
  })();
  return true;
});

// PDF -> Markdown via the native host (markitdown). Needs the host + `pip install markitdown`.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "markitdown") return;
  try {
    chrome.runtime.sendNativeMessage(
      "com.endnote_import.host",
      { action: "markitdown", url: msg.url, title: msg.title },
      (resp) => {
        if (chrome.runtime.lastError)
          sendResponse({ ok: false, error: "native host not installed (run nativehost\\install.py): " + chrome.runtime.lastError.message });
        else sendResponse(resp || { ok: false, error: "no response" });
      }
    );
  } catch (e) { sendResponse({ ok: false, error: (e && e.message) }); }
  return true;
});

// Live journal quality from OpenAlex (CC0): h-index / 2yr impact / works / DOAJ.
function fmtRate(s, stats, works) {
  stats = stats || {};
  const h = stats.h_index != null ? stats.h_index : null;
  const imp = stats["2yr_mean_citedness"];
  return {
    label: h != null ? "h" + h : "?",
    tier: h == null ? 0 : h >= 200 ? 4 : h >= 100 ? 3 : h >= 40 ? 2 : 1,
    detail: (s.display_name || "") +
      (h != null ? " · h-index " + h : "") +
      (imp != null ? " · impact " + imp.toFixed(1) : "") +
      (works != null ? " · " + works + " works" : "") +
      (s.is_in_doaj ? " · DOAJ" : ""),
  };
}
async function openAlexRate(hint) {
  if (hint.issn) {
    const j = await jget("https://api.openalex.org/sources?per-page=1&filter=issn:" + encodeURIComponent(hint.issn) + "&select=display_name,is_in_doaj,summary_stats,works_count");
    const s = j && j.results && j.results[0];
    if (s) return fmtRate(s, s.summary_stats, s.works_count);
  }
  const w = await jget("https://api.openalex.org/works?per-page=1&filter=title.search:" + encodeURIComponent(hint.title) + "&select=primary_location");
  const src = w && w.results && w.results[0] && w.results[0].primary_location && w.results[0].primary_location.source;
  if (!src || !src.id) return null;
  const id = src.id.replace("https://openalex.org/", "");
  const s = await jget("https://api.openalex.org/sources/" + id + "?select=display_name,is_in_doaj,summary_stats,works_count");
  return s ? fmtRate(s, s.summary_stats, s.works_count) : null;
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "rate") return;
  (async () => {
    try { const r = await openAlexRate(msg); sendResponse(r ? { ok: true, ...r } : { ok: false, error: "no journal match" }); }
    catch (e) { sendResponse({ ok: false, error: (e && e.message) }); }
  })();
  return true;
});
