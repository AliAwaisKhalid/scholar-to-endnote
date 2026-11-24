import sys, struct, json, os, tempfile, time, re

def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))

def send_msg(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def downloads_dir():
    d = os.path.join(os.path.expanduser("~"), "Downloads")
    return d if os.path.isdir(d) else tempfile.gettempdir()

def safe_name(s, default):
    s = re.sub(r"[^\w.-]+", "_", (s or "").strip())[:80].strip("_")
    return s or default

def do_endnote(msg):
    ext = msg.get("format", "ris") or "ris"
    path = os.path.join(tempfile.gettempdir(), "scholar-endnote-%d.%s" % (int(time.time()), ext))
    with open(path, "w", encoding="utf-8") as f:
        f.write(msg.get("data", ""))
    os.startfile(path)  # app associated to .ris (EndNote) -> import dialog
    return {"ok": True, "file": path}

def do_markitdown(msg):
    try:
        from markitdown import MarkItDown
    except ImportError:
        return {"ok": False, "error": "markitdown not installed. Run: pip install markitdown"}
    import urllib.request
    url = msg.get("url", "")
    if not url:
        return {"ok": False, "error": "no url"}
    base = safe_name(msg.get("title", ""), "scholar-%d" % int(time.time()))
    pdf = os.path.join(tempfile.gettempdir(), base + ".pdf")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if data[:5] != b"%PDF-":
        return {"ok": False, "error": "URL did not return a PDF (likely a landing page or paywall)"}
    with open(pdf, "wb") as f:
        f.write(data)
    text = MarkItDown().convert(pdf).text_content
    out = os.path.join(downloads_dir(), base + ".md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        os.remove(pdf)
    except OSError:
        pass
    return {"ok": True, "file": out}

def main():
    msg = read_msg()
    if not msg:
        return
    try:
        action = msg.get("action") or ("endnote" if "data" in msg else None)
        if action == "markitdown":
            send_msg(do_markitdown(msg))
        elif action == "endnote":
            send_msg(do_endnote(msg))
        else:
            send_msg({"ok": False, "error": "unknown action"})
    except Exception as e:
        send_msg({"ok": False, "error": str(e)})

if __name__ == "__main__":
    main()
