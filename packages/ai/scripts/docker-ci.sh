#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
ai="$root/packages/ai"
image=${IMAGE:-kikobeats/microlink-api:ai}
cmd=${1:-test}

if ! docker image inspect "$image" >/dev/null 2>&1; then
  weights=$(find "$ai/model" -name weights.bin -print -quit 2>/dev/null || true)
  if [ ! -f "$weights" ]; then
    BROWSERLESS_AI_DIR="$ai/model" pnpm --filter @browserless/ai install-model
  fi
  docker build --platform linux/amd64 -t "$image" -f "$ai/Dockerfile" "$ai"
fi

exec docker run --rm --platform linux/amd64 --shm-size=2g \
  -e CI=1 \
  -e DEBUG=browserless:ai \
  -e DISPLAY=:99 \
  -e LIBGL_ALWAYS_SOFTWARE=1 \
  -v "$root:/src:ro" \
  -v browserless-ai-ci-work:/work \
  -v browserless-ai-ci-chrome:/root/.cache/puppeteer \
  "$image" \
  with-xvfb bash -lc "set -eu
    tar -C /src --exclude node_modules --exclude .git -cf - . | tar -C /work -xf -
    cd /work
    pnpm install --dangerously-allow-all-builds
    pnpm --filter @browserless/ai exec puppeteer browsers install chrome
    if [ \"$cmd\" = test ]; then
      pnpm --filter @browserless/ai test
    else
      pnpm --filter @browserless/ai exec node $cmd
    fi"
