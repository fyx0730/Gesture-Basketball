#!/usr/bin/env bash
set -euo pipefail

# Download and map Basketball FRVR audio files into i/s/*.mp3
# Usage:
#   bash download-game-audio.sh links.txt
#   cat links.txt | bash download-game-audio.sh
#
# links.txt supports:
#   1) url only
#   2) targetName|url  (e.g. hit01.mp3|https://.../abc.mp3)
#
# The script auto-guesses target names from URL filenames when possible.

DEST_DIR="i/s"
TMP_DIR=".audio-download-tmp"

REQUIRED_TARGETS=(
  "awww1.mp3" "awww2.mp3"
  "clap1.mp3" "clap2.mp3" "clap3.mp3" "clap4.mp3" "clap5.mp3"
  "coinpickup.mp3" "ding.mp3"
  "hit01.mp3" "hit02.mp3" "hit03.mp3" "hit04.mp3" "hit05.mp3" "hit06.mp3" "hit07.mp3"
  "music.mp3" "net.mp3" "netdirect.mp3" "throw01.mp3" "throw02.mp3"
)

mkdir -p "$DEST_DIR" "$TMP_DIR"

trim() {
  local s="$1"
  # shellcheck disable=SC2001
  s="$(echo "$s" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  echo "$s"
}

target_exists_in_required() {
  local target="$1"
  local x
  for x in "${REQUIRED_TARGETS[@]}"; do
    [[ "$x" == "$target" ]] && return 0
  done
  return 1
}

guess_target_from_url() {
  local url="$1"
  local name lower n
  name="$(basename "${url%%\?*}")"
  lower="$(echo "$name" | tr '[:upper:]' '[:lower:]')"

  if [[ "$lower" =~ netdirect ]]; then
    echo "netdirect.mp3"; return 0
  fi
  if [[ "$lower" =~ (^|[^a-z])net([^a-z]|$) ]]; then
    echo "net.mp3"; return 0
  fi
  if [[ "$lower" =~ (music|bgm|theme) ]]; then
    echo "music.mp3"; return 0
  fi
  if [[ "$lower" =~ (coin|pickup) ]]; then
    echo "coinpickup.mp3"; return 0
  fi
  if [[ "$lower" =~ (ding|timeup|time-up) ]]; then
    echo "ding.mp3"; return 0
  fi
  if [[ "$lower" =~ awww[-_]?0?([1-2]) ]]; then
    n="${BASH_REMATCH[1]}"
    echo "awww${n}.mp3"; return 0
  fi
  if [[ "$lower" =~ clap[-_]?0?([1-5]) ]]; then
    n="${BASH_REMATCH[1]}"
    echo "clap${n}.mp3"; return 0
  fi
  if [[ "$lower" =~ hit[-_]?0?([1-7]) ]]; then
    n="${BASH_REMATCH[1]}"
    printf "hit%02d.mp3\n" "$n"; return 0
  fi
  if [[ "$lower" =~ throw[-_]?0?([1-2]) ]]; then
    n="${BASH_REMATCH[1]}"
    printf "throw%02d.mp3\n" "$n"; return 0
  fi

  return 1
}

download_one() {
  local url="$1"
  local target="$2"
  local tmp_file
  tmp_file="$TMP_DIR/$target"

  echo "-> $target"
  curl -fL --retry 2 --connect-timeout 10 --max-time 60 "$url" -o "$tmp_file"
  mv "$tmp_file" "$DEST_DIR/$target"
}

input_lines=()
if [[ $# -ge 1 ]]; then
  while IFS= read -r line; do
    input_lines+=("$line")
  done < "$1"
else
  while IFS= read -r line; do
    input_lines+=("$line")
  done
fi

if [[ ${#input_lines[@]} -eq 0 ]]; then
  echo "No input lines detected."
  echo "Example:"
  echo "  echo 'ding.mp3|https://example.com/a.mp3' | bash download-game-audio.sh"
  exit 1
fi

mapped_count=0
unmapped_count=0
unknown_slot=1

for raw in "${input_lines[@]}"; do
  line="$(trim "$raw")"
  [[ -z "$line" ]] && continue
  [[ "${line:0:1}" == "#" ]] && continue

  target=""
  url=""

  if [[ "$line" == *"|"* ]]; then
    target="$(trim "${line%%|*}")"
    url="$(trim "${line#*|}")"
  else
    url="$line"
    if guess_target_from_url "$url" >/dev/null; then
      target="$(guess_target_from_url "$url")"
    fi
  fi

  if [[ -z "$target" ]]; then
    target="_unmapped_${unknown_slot}.mp3"
    unknown_slot=$((unknown_slot + 1))
    unmapped_count=$((unmapped_count + 1))
    echo "!! Could not infer target, saving as $target"
  fi

  if [[ "$target" != *_unmapped_* ]] && ! target_exists_in_required "$target"; then
    echo "!! Invalid target name '$target' (skip): $url"
    continue
  fi

  if download_one "$url" "$target"; then
    mapped_count=$((mapped_count + 1))
  else
    echo "!! Download failed: $url"
  fi
done

echo
echo "Downloaded files: $mapped_count"
echo "Auto-unmapped files: $unmapped_count"
echo

echo "Missing required targets:"
missing=0
for t in "${REQUIRED_TARGETS[@]}"; do
  if [[ ! -f "$DEST_DIR/$t" ]]; then
    echo "  - $t"
    missing=$((missing + 1))
  fi
done

if [[ $missing -eq 0 ]]; then
  echo "  (none)"
fi

echo
echo "Done. Files are in: $DEST_DIR"
