#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
chrome="$HOME/Library/Application Support/Google/Chrome"
image=${IMAGE:-kikobeats/microlink-api:base}
cmd=${1:-examples/index.js}

exec docker run --rm --platform linux/amd64 --shm-size=2g \
  -e CI=1 \
  -e DEBUG=browserless:ai \
  -e BROWSERLESS_AI_DUMPIO=1 \
  -e BROWSERLESS_AI_DIR=/work/model \
  -e BROWSERLESS_AI_PROFILE=/work/chrome-profile \
  -e DISPLAY=:99 \
  -e LIBGL_ALWAYS_SOFTWARE=1 \
  -v "$root:/src:ro" \
  -v browserless-ai-ci-work:/work \
  -v browserless-ai-ci-chrome:/root/.cache/puppeteer \
  -v "$chrome/OptGuideOnDeviceModel:/root/.cache/browserless-ai/nano:ro" \
  -v "$chrome/optimization_guide_model_store/49:/root/.cache/browserless-ai/prompt:ro" \
  -v "$chrome/optimization_guide_model_store/51:/root/.cache/browserless-ai/summarize:ro" \
  -v "$chrome/optimization_guide_model_store/2:/root/.cache/browserless-ai/detect:ro" \
  "$image" \
  with-xvfb bash -lc "set -eu
    tar -C /src --exclude node_modules --exclude .git -cf - . | tar -C /work -xf -
    if [ ! -f /work/model/nano/2025.8.8.1141/weights.bin ]; then
      mkdir -p /work/model
      cp -a /root/.cache/browserless-ai/. /work/model/
    fi
    cd /work
    pnpm install --dangerously-allow-all-builds
    pnpm --filter @browserless/ai exec puppeteer browsers install chrome
    pnpm --filter @browserless/ai exec node $cmd"
