"""Build rankings/ for the extension from a ranking CSV.

Usage:
  python build_rankings.py <RankingName> <csv> [name_col] [rank_col]

The CSV needs a header row. name_col auto-detects among journal/title/name/
source; rank_col defaults to the last column. Delimiter (',' or ';') is sniffed.
Writes <extension_root>/rankings/<RankingName>.json (NORMKEY -> label) and
updates rankings/index.json. Keys are UPPERCASE with non-alphanumerics stripped,
matching content.js normKey(), so lookups line up with Scholar venue names.

Point it at any list (e.g. a SCImago CSV, or a column you extracted from the
AndreasKarasenko repo's data). Respect each list's own redistribution terms.
"""
import sys, os, csv, json, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "rankings")

def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    name, path = sys.argv[1], sys.argv[2]
    name_col = sys.argv[3] if len(sys.argv) > 3 else None
    rank_col = sys.argv[4] if len(sys.argv) > 4 else None
    os.makedirs(OUT, exist_ok=True)

    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096); f.seek(0)
        delim = ";" if sample.count(";") > sample.count(",") else ","
        rd = csv.DictReader(f, delimiter=delim)
        cols = rd.fieldnames or []
        if not name_col:
            for c in cols:
                if c and c.strip().lower() in ("journal", "title", "name", "source", "source title", "journal name"):
                    name_col = c; break
            name_col = name_col or cols[0]
        if not rank_col:
            rank_col = cols[-1]
        m = {}
        for row in rd:
            k = norm(row.get(name_col, ""))
            v = (row.get(rank_col, "") or "").strip()
            if k and v:
                m[k] = v

    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(m, f)

    idxp = os.path.join(OUT, "index.json")
    idx = json.load(open(idxp, encoding="utf-8")) if os.path.exists(idxp) else {"rankings": []}
    idx["rankings"] = [r for r in idx["rankings"] if r["name"] != name] + [{"name": name, "file": name + ".json"}]
    with open(idxp, "w", encoding="utf-8") as f:
        json.dump(idx, f, indent=2)

    print("Wrote %d journals to rankings/%s.json (name_col=%r rank_col=%r)" % (len(m), name, name_col, rank_col))

if __name__ == "__main__":
    main()
