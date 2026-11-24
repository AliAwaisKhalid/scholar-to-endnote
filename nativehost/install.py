"""Register the EndNote native-messaging host (Windows, Chrome).

Auto-detects this extension's ID from Chrome's preferences so you don't have to
copy it. Override by passing an ID:  python install.py <EXTENSION_ID>
"""
import json, os, glob, sys, winreg

HERE = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(HERE)  # ...\scholar-endnote-extension
HOST_NAME = "com.endnote_import.host"


def detect_ids():
    base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "User Data")
    want = os.path.normcase(os.path.abspath(EXT_DIR))
    base_name = os.path.basename(EXT_DIR)
    ids = set()
    prefs = glob.glob(os.path.join(base, "*", "Preferences")) + \
            glob.glob(os.path.join(base, "*", "Secure Preferences"))
    for pref in prefs:
        try:
            with open(pref, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        settings = (data.get("extensions", {}) or {}).get("settings", {}) or {}
        for eid, meta in settings.items():
            p = meta.get("path", "") or ""
            if not p:
                continue
            if os.path.normcase(os.path.abspath(p)) == want or \
               os.path.basename(p.rstrip("\\/")) == base_name:
                ids.add(eid)
    return ids


def main():
    ids = {sys.argv[1]} if len(sys.argv) > 1 else detect_ids()
    if not ids:
        print("Could not auto-detect the extension ID.")
        print("Open chrome://extensions, copy the ID, then run:  python install.py <EXTENSION_ID>")
        sys.exit(1)

    manifest = {
        "name": HOST_NAME,
        "description": "Scholar to EndNote import host",
        "path": os.path.join(HERE, "endnote_host.bat"),
        "type": "stdio",
        "allowed_origins": ["chrome-extension://%s/" % i for i in sorted(ids)],
    }
    mf_path = os.path.join(HERE, "host-manifest.json")
    with open(mf_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,
                          r"Software\Google\Chrome\NativeMessagingHosts\%s" % HOST_NAME) as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, mf_path)

    print("Registered host for extension id(s):", ", ".join(sorted(ids)))
    print("Manifest:", mf_path)
    print("Restart Chrome, then use target 'EndNote (auto-import)'.")


if __name__ == "__main__":
    main()
