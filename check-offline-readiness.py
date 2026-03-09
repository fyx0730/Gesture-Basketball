#!/usr/bin/env python3
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent


REQUIRED_FILES = [
    ROOT / "index.html",
    ROOT / "frame.html",
    ROOT / "js" / "gesture-plugin.js",
    ROOT / "v" / "1576154515838" / "external.js",
    ROOT / "vendor" / "mediapipe" / "hands" / "hands.js",
    ROOT / "vendor" / "mediapipe" / "camera_utils" / "camera_utils.js",
]

REQUIRED_AUDIO = [
    "awww1.mp3", "awww2.mp3",
    "clap1.mp3", "clap2.mp3", "clap3.mp3", "clap4.mp3", "clap5.mp3",
    "coinpickup.mp3", "ding.mp3",
    "hit01.mp3", "hit02.mp3", "hit03.mp3", "hit04.mp3", "hit05.mp3", "hit06.mp3", "hit07.mp3",
    "music.mp3", "net.mp3", "netdirect.mp3", "throw01.mp3", "throw02.mp3",
]


def file_ok(path: Path) -> bool:
    return path.exists() and path.is_file() and path.stat().st_size > 0


def scan_runtime_remote_urls(path: Path):
    txt = path.read_text(errors="ignore")
    # Only match quoted URL literals to avoid minified-comment false positives.
    urls = sorted(set(re.findall(r"""["'](https?://[^"']+)["']""", txt)))
    return urls


def scan_local_src_href(path: Path):
    txt = path.read_text(errors="ignore")
    refs = []
    for m in re.finditer(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", txt):
        ref = m.group(1).strip()
        if not ref or ref.startswith("data:") or ref.startswith("javascript:"):
            continue
        refs.append(ref)
    return refs


def resolve_ref(ref: str):
    if ref.startswith("http://") or ref.startswith("https://") or ref.startswith("//"):
        return None
    clean = ref.split("?", 1)[0].split("#", 1)[0]
    clean = clean.lstrip("./")
    if not clean:
        return None
    return ROOT / clean


def main():
    missing = []

    for p in REQUIRED_FILES:
        if not file_ok(p):
            missing.append(str(p.relative_to(ROOT)))

    audio_dir = ROOT / "v" / "1576154515838" / "i" / "s"
    for name in REQUIRED_AUDIO:
        p = audio_dir / name
        if not file_ok(p):
            missing.append(str(p.relative_to(ROOT)))

    index_refs = scan_local_src_href(ROOT / "index.html")
    frame_refs = scan_local_src_href(ROOT / "frame.html")
    broken_ref_files = []
    for ref in index_refs + frame_refs:
        rp = resolve_ref(ref)
        if rp is None:
            continue
        if not rp.exists():
            broken_ref_files.append(ref)

    runtime_remote = []
    for f in [ROOT / "index.html", ROOT / "js" / "gesture-plugin.js"]:
        runtime_remote.extend(scan_runtime_remote_urls(f))
    runtime_remote = sorted(set(runtime_remote))

    print("== Offline Readiness Report ==")
    print()
    print(f"Required core files checked: {len(REQUIRED_FILES)}")
    print(f"Required audio files checked: {len(REQUIRED_AUDIO)}")
    print()

    if missing:
        print("[FAIL] Missing required local files:")
        for m in missing:
            print(f" - {m}")
    else:
        print("[OK] Required local files are complete.")

    if broken_ref_files:
        print()
        print("[WARN] Broken local src/href references:")
        for ref in sorted(set(broken_ref_files)):
            print(f" - {ref}")
    else:
        print("[OK] Local src/href references resolve.")

    if runtime_remote:
        print()
        print("[WARN] Remote URLs found in runtime files (check if acceptable offline):")
        for u in runtime_remote:
            print(f" - {u}")
    else:
        print("[OK] No remote URLs in runtime files.")

    print()
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
