// Scholar -> EndNote/Zotero Export : content script
// Works on search results, "cited by" lists, saved-library (/scholar*) and
// author-profile (/citations*) pages. Selection is a persistent cross-page cart.

const CART_KEY = "en_cart";
const isProfile = location.pathname.indexOf("/citations") === 0;

// ---- row extraction per page type --------------------------------------
function rows() {
  return isProfile
    ? [...document.querySelectorAll("#gsc_a_b .gsc_a_tr")]
    : [...document.querySelectorAll(".gs_r.gs_or.gs_scl")];
}

function parseRow(el) {
  if (isProfile) {
    const a = el.querySelector(".gsc_a_at");
    if (!a) return null;
    const grays = el.querySelectorAll(".gs_gray");
    const yEl = el.querySelector(".gsc_a_y .gsc_a_h, .gsc_a_y");
    const forView = (a.href.match(/citation_for_view=([^&]+)/) || [])[1] || "";
    return {
      key: "cv:" + forView,
      title: a.textContent.trim(),
      authors: grays[0] ? grays[0].textContent.trim() : "",
      venue: grays[1] ? grays[1].textContent.replace(/,\s*\d{4}.*$/, "").trim() : "",
      year: yEl ? (yEl.textContent.match(/\d{4}/) || [""])[0] : "",
      cid: "", // profiles have no Cite-popup cluster id
    };
  }
  const cid = el.getAttribute("data-cid");
  if (!cid) return null;
  const t = el.querySelector(".gs_rt");
  const meta = el.querySelector(".gs_a");
  const metaTxt = meta ? meta.textContent : "";
  return {
    key: "cid:" + cid,
    title: t ? t.textContent.replace(/^\[\w+\]\s*/, "").trim() : "",
    authors: metaTxt.split(" - ")[0] || "",
    venue: (metaTxt.split(" - ")[1] || "").replace(/,\s*\d{4}.*$/, "").replace(/\s+\d+.*$/, "").trim(),
    year: (metaTxt.match(/\b(19|20)\d{2}\b/) || [""])[0],
    cid,
  };
}

// ---- cart (chrome.storage.local) ---------------------------------------
async function getCart() {
  const o = await chrome.storage.local.get(CART_KEY);
  return o[CART_KEY] || {};
}
async function setCart(c) { await chrome.storage.local.set({ [CART_KEY]: c }); }

async function toggle(item, on) {
  const c = await getCart();
  if (on) c[item.key] = item; else delete c[item.key];
  await setCart(c);
}

// ---- decoration ---------------------------------------------------------
async function decorate() {
  const c = await getCart();
  rows().forEach((el) => {
    if (el.dataset.enDecorated) return;
    const item = parseRow(el);
    if (!item) return;
    el.dataset.enDecorated = "1";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "en-pick";
    box.checked = !!c[item.key];
    box.title = "Add/remove from EndNote cart";
    box.addEventListener("change", () => toggle(item, box.checked));

    const quick = document.createElement("button");
    quick.className = "en-quick";
    quick.textContent = "↓EN";
    quick.title = "Export this one now";
    quick.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      doExport([item]);
    });

    const wrap = document.createElement("span");
    wrap.className = "en-ctrl";
    wrap.append(box, quick);

    const star = document.createElement("button");
    star.className = "en-quick";
    star.textContent = "★";
    star.title = "Journal quality (live, OpenAlex)";
    star.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      doRate(el, item);
    });
    wrap.append(star);

    // ↓MD only when the result has a PDF link (via native host + markitdown)
    const pdfA = isProfile ? null : el.querySelector(".gs_or_ggsm a, .gs_ggs a");
    if (pdfA && /^https?:/.test(pdfA.href)) {
      const url = pdfA.href;
      const md = document.createElement("button");
      md.className = "en-quick";
      md.textContent = "↓MD";
      md.title = "Download PDF as Markdown (markitdown)";
      md.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        doMarkitdown(url, item.title);
      });
      wrap.append(md);
    }

    const anchor = isProfile ? el.querySelector(".gsc_a_t") : el.querySelector(".gs_ri");
    (anchor || el).prepend(wrap);
    renderBundled(el, item);
  });
}

// ---- journal quality ----------------------------------------------------
function badgeHost(el) {
  return el.querySelector(".gs_ri") || el.querySelector(".gsc_a_t") || el;
}
function doRate(el, item) {
  let b = el.querySelector(".en-badge-live");
  if (!b) {
    b = document.createElement("span");
    b.className = "en-badge en-badge-live";
    badgeHost(el).appendChild(b);
  }
  b.textContent = "…"; b.title = ""; delete b.dataset.tier;
  chrome.runtime.sendMessage({ type: "rate", title: item.title }, (resp) => {
    if (chrome.runtime.lastError || !resp) { b.textContent = "rate?"; return; }
    if (!resp.ok) { b.textContent = "n/a"; b.title = resp.error || ""; return; }
    b.textContent = resp.label; b.title = resp.detail; b.dataset.tier = resp.tier;
  });
}

// Optional bundled ranking lists: drop rankings/index.json + per-list JSON maps
// (NORMKEY -> label) into the extension. Inert if absent.
let RANKINGS = null;
async function loadRankings() {
  try {
    const idx = await (await fetch(chrome.runtime.getURL("rankings/index.json"))).json();
    const out = [];
    for (const r of idx.rankings || []) {
      const map = await (await fetch(chrome.runtime.getURL("rankings/" + r.file))).json();
      out.push({ name: r.name, map });
    }
    RANKINGS = out;
  } catch (e) { RANKINGS = []; }
}
function normKey(s) { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function renderBundled(el, item) {
  if (!RANKINGS || !RANKINGS.length || !item.venue) return;
  const k = normKey(item.venue);
  const host = badgeHost(el);
  for (const r of RANKINGS) {
    const v = r.map[k];
    if (!v) continue;
    const b = document.createElement("span");
    b.className = "en-badge en-rank";
    b.textContent = r.name + ":" + v;
    b.title = item.venue;
    host.appendChild(b);
  }
}

// ---- action bar ---------------------------------------------------------
let statusEl, fmtSel, tgtSel;

function buildBar() {
  if (document.getElementById("en-bar")) return;
  const bar = document.createElement("div");
  bar.id = "en-bar";
  bar.innerHTML =
    '<span id="en-count">cart: 0</span>' +
    '<select id="en-fmt" title="File format">' +
    '<option value="ris">RIS</option><option value="enw">EndNote .enw</option>' +
    '<option value="bib">BibTeX</option><option value="rfw">RefWorks</option></select>' +
    '<select id="en-tgt" title="Send to">' +
    '<option value="file">Download file</option><option value="zotero">Zotero (running)</option>' +
    '<option value="endnote">EndNote (auto-import)</option></select>' +
    '<button id="en-go">Export cart</button>' +
    '<button id="en-clear">Clear</button>' +
    '<span id="en-status"></span>';
  document.body.appendChild(bar);
  statusEl = bar.querySelector("#en-status");
  fmtSel = bar.querySelector("#en-fmt");
  tgtSel = bar.querySelector("#en-tgt");

  bar.querySelector("#en-go").onclick = async () => {
    const items = Object.values(await getCart());
    if (items.length) doExport(items);
    else flash("Cart empty — tick some results");
  };
  bar.querySelector("#en-clear").onclick = async () => {
    await setCart({});
    document.querySelectorAll(".en-pick").forEach((b) => (b.checked = false));
  };
}

function flash(m) { if (statusEl) statusEl.textContent = m; }

async function refreshCount() {
  const n = Object.keys(await getCart()).length;
  const el = document.getElementById("en-count");
  if (el) el.textContent = "cart: " + n;
}

function doMarkitdown(url, title) {
  flash("Converting PDF…");
  chrome.runtime.sendMessage({ type: "markitdown", url, title }, (resp) => {
    if (chrome.runtime.lastError) { flash("Error: " + chrome.runtime.lastError.message); return; }
    if (!resp) { flash("No response"); return; }
    flash(resp.ok ? "Markdown saved: " + resp.file : "Failed: " + (resp.error || "unknown"));
  });
}

function doExport(items) {
  flash("Processing " + items.length + "…");
  chrome.runtime.sendMessage(
    { type: "export", items, fmt: fmtSel.value, target: tgtSel.value },
    (resp) => {
      if (chrome.runtime.lastError) { flash("Error: " + chrome.runtime.lastError.message); return; }
      if (!resp) { flash("No response"); return; }
      if (!resp.ok) { flash("Failed: " + (resp.error || "unknown")); return; }
      flash(
        "Done: " + resp.done + "/" + items.length +
        " (enriched " + resp.enriched + ", fallback " + resp.fallback + ")" +
        (resp.note ? " — " + resp.note : "")
      );
    }
  );
}

// ---- init ---------------------------------------------------------------
buildBar();
refreshCount();
loadRankings().then(decorate); // load bundled lists (if any) before first pass
chrome.storage.onChanged.addListener((ch) => { if (ch[CART_KEY]) refreshCount(); });
new MutationObserver(() => decorate()).observe(document.body, { childList: true, subtree: true });
