#!/usr/bin/env bash
# Checks that this Mac can run the Northwind chat stack, and says which model fits it.
#   bash scripts/doctor.sh        (or: pnpm stack:doctor)
# ✓ fine · ! worth knowing, not blocking · ✗ must be fixed (exit code 1).
# Only needs Docker Desktop; works with macOS's bash 3.2.
#
# Note: with `set -o pipefail`, never pipe into `grep -q` (it exits early and the pipeline
# fails); capture output first and test it.
set -uo pipefail
cd "$(dirname "$0")/.."

ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
FAILED=0

# version_at_least 2.38.0 5.6.1 → true when the second is >= the first.
version_at_least() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$1" ]]; }

echo "This Mac"
if [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]]; then
  ok "$(sysctl -n machdep.cpu.brand_string) (Apple Silicon: the model runs on the GPU)"
else
  warn "$(uname -sm): not an Apple Silicon Mac; the model will run on the CPU, much slower"
fi

RAM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 / 1024 ))
if (( RAM_GB >= 24 )); then
  ok "${RAM_GB} GB memory: Qwen3 4B (the default), or Qwen3 8B for the most accurate answers"
elif (( RAM_GB >= 16 )); then
  ok "${RAM_GB} GB memory: Qwen3 4B (the default)"
elif (( RAM_GB >= 8 )); then
  warn "${RAM_GB} GB memory: Qwen3 4B will fit, but close other apps while chatting"
else
  bad "${RAM_GB} GB memory: too little for a local model"
fi

FREE_GB=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if (( FREE_GB >= 15 )); then
  ok "${FREE_GB} GB free disk"
else
  warn "${FREE_GB} GB free disk: the images and the model need about 10 GB"
fi

echo "Docker"
if ! command -v docker >/dev/null; then
  bad "Docker isn't installed: get Docker Desktop for Apple silicon at https://www.docker.com/products/docker-desktop/"
elif ! docker info >/dev/null 2>&1; then
  bad "Docker Desktop is installed but not running: open it and wait for it to start"
else
  PLATFORM="$(docker version --format '{{.Server.Platform.Name}}' 2>/dev/null)"
  DESKTOP="$(sed -n 's/^Docker Desktop \([0-9.]*\).*/\1/p' <<<"$PLATFORM")"
  if [[ -n "$DESKTOP" ]] && version_at_least 4.40.0 "$DESKTOP"; then
    ok "Docker Desktop $DESKTOP"
  elif [[ -n "$DESKTOP" ]]; then
    bad "Docker Desktop $DESKTOP: version 4.40 or later is needed (Docker menu → Check for updates)"
  else
    warn "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (not Docker Desktop: Model Runner may be missing)"
  fi

  COMPOSE="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  # The stack's models: section needs Compose 2.38 or later.
  if [[ -n "$COMPOSE" ]] && version_at_least 2.38.0 "$COMPOSE"; then
    ok "Docker Compose $COMPOSE"
  else
    bad "Docker Compose ${COMPOSE:-missing}: 2.38 or later is needed (update Docker Desktop)"
  fi

  if ! docker model version >/dev/null 2>&1; then
    bad "Docker Model Runner is missing: update Docker Desktop to 4.40 or later"
  else
    STATUS="$(docker model status 2>&1)"
    if [[ "$STATUS" == *"is running"* ]]; then
      ok "Docker Model Runner is on"
    else
      warn "Docker Model Runner is off: setup turns it on (or Docker Desktop → Settings → AI)"
    fi
  fi

  VM_GB=$(( $(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0) / 1024 / 1024 / 1024 ))
  if (( RAM_GB <= 16 && VM_GB > 4 )); then
    warn "Docker's VM may use up to ${VM_GB} GB; the model runs outside it and needs the rest. On a ${RAM_GB} GB Mac, about 3 GB is enough (Docker Desktop → Settings → Resources → Memory)"
  elif (( VM_GB > 0 )); then
    ok "Docker's VM: up to ${VM_GB} GB"
  fi
fi

echo "This repo"
if [[ -f .env ]]; then
  ok ".env exists (setup keeps it)"
else
  warn "no .env yet: setup creates one with a random API key"
fi

# The stack's ports must be free, unless they're the stack's own containers.
for port in 5173 3000 27017; do
  PROCESS="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}')"
  if [[ -z "$PROCESS" ]]; then
    ok "port $port is free"
  elif [[ "$PROCESS" == com.docke* || "$PROCESS" == vpnkit* ]]; then
    ok "port $port is used by Docker (the stack itself, presumably)"
  else
    warn "port $port is in use by '$PROCESS' (pnpm dev?): stop it before starting the stack"
  fi
done

if (( FAILED )); then
  printf '\nFix the ✗ items above, then run this again.\n'
fi
exit "$FAILED"
