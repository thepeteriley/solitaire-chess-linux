#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
qa_arch="${1:-amd64}"
case "$qa_arch" in amd64|arm64) ;; *) echo 'Use amd64 or arm64' >&2; exit 1;; esac
qa_base="${2:-debian:13-slim}"
qa_version="$(node -p 'require("./package.json").version')-1"
qa_deb="solitaire-chess_${qa_version}_${qa_arch}.deb"
qa_context="release/linux/qa-${qa_arch}-context"
qa_output="$(pwd)/qa/linux-${qa_arch}"
mkdir -p "$qa_context" "$qa_output"
chmod 777 "$qa_output"
cp "release/linux/$qa_deb" "$qa_context/"
docker build --platform "linux/$qa_arch" -f linux/Dockerfile.qa --build-arg "BASE_IMAGE=$qa_base" --build-arg "DEB_FILE=$qa_deb" -t "solitaire-chess-qa:$qa_arch" "$qa_context"
docker run --rm --platform "linux/$qa_arch" --cap-add SYS_ADMIN --security-opt seccomp=unconfined -v "$(pwd):/work:ro" -v "$qa_output:/work/qa:rw" "solitaire-chess-qa:$qa_arch" sh -c 'node --test tests/engine.test.cjs && xvfb-run -a -s "-screen 0 1440x1100x24" dbus-run-session -- node scripts/smoke.mjs'
