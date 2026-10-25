#!/usr/bin/env bash
# One command from a fresh Mac to a running Northwind chat: checks, settings, model, images,
# database, stack. Only needs Docker Desktop (no Node). Safe to re-run: it keeps .env and
# never reseeds a database that already has data.
#
#   bash scripts/setup.sh             (or: pnpm stack:setup)
#   bash scripts/setup.sh --dry-run   show each step without doing it
#
# Works with macOS's bash 3.2. With `set -o pipefail`, never pipe into `grep -q`.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
note() { printf '  %s\n' "$1"; }
# Runs a command, or only shows it with --dry-run.
run() {
  printf '  \033[2m$ %s\033[0m\n' "$*"
  if (( ! DRY_RUN )); then "$@"; fi
}

DEFAULT_MODEL=hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M
CONTEXT_SIZE=16384 # the same as the stack's models: section

# ---------------------------------------------------------------------------- 1. checks
step "Checking this Mac"
if ! bash scripts/doctor.sh; then
  echo "Fix the ✗ items above, then run setup again."
  exit 1
fi

# ---------------------------------------------------------------------------- 2. settings
step "Settings (.env)"
if [[ -f .env ]]; then
  note ".env exists; keeping it"
else
  KEY="$(openssl rand -hex 24)"
  if (( DRY_RUN )); then
    note "would create .env from .env.example, with a new random API key and LLM_MODEL=$DEFAULT_MODEL"
  else
    sed -e "s|^API_KEYS=.*|API_KEYS=$KEY|" \
      -e "s|^NORTHWIND_API_KEY=.*|NORTHWIND_API_KEY=$KEY|" \
      .env.example >.env
    printf '\n# Chosen by setup\nLLM_MODEL=%s\n' "$DEFAULT_MODEL" >>.env
    note "created .env with a new random API key and the model $DEFAULT_MODEL"
  fi
fi
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
MODEL="${LLM_MODEL:-$DEFAULT_MODEL}"
# The chat's key must be one the API accepts.
if [[ -n "${NORTHWIND_API_KEY:-}" && ",${API_KEYS:-}," != *",${NORTHWIND_API_KEY},"* ]]; then
  echo "  .env: NORTHWIND_API_KEY must be one of API_KEYS. Fix .env, then run setup again."
  exit 1
fi
note "model: $MODEL"

# ---------------------------------------------------------------------------- 3. model runner
step "Docker Model Runner"
STATUS="$(docker model status 2>&1 || true)"
if [[ "$STATUS" == *"is running"* ]] && curl -s -m 3 -o /dev/null http://localhost:12434/engines/v1/models; then
  note "on, with access from this Mac on port 12434"
else
  note "Turning it on, with access from this Mac on port 12434 (for pnpm dev)."
  note "This changes a Docker Desktop setting (Settings → AI)."
  run docker desktop enable model-runner --tcp=12434
fi

# ---------------------------------------------------------------------------- 4. downloads
step "Base images (downloads to this Mac only)"
for image in "${NODE_IMAGE:-node:24-alpine}" "${MONGO_IMAGE:-mongo:8}"; do
  if ! run docker pull --quiet "$image"; then
    echo "  Couldn't pull $image. If Docker Hub answered 429 (rate limit), set NODE_IMAGE and"
    echo "  MONGO_IMAGE in .env to another registry (examples in .env.example), then run setup again."
    exit 1
  fi
done

step "The model (several GB the first time; downloads to this Mac only)"
run docker model pull "$MODEL"
# pnpm dev talks to Model Runner directly; give it the same context as the stack.
run docker model configure --context-size "$CONTEXT_SIZE" "$MODEL"

# ---------------------------------------------------------------------------- 5. images
step "Building the stack's images"
run docker compose --profile stack --profile seed build

# ---------------------------------------------------------------------------- 6. start
step "Starting the stack"
# Something else (often pnpm dev) on the stack's ports would make it fail halfway.
for port in "${AGENT_PORT:-5173}" "${API_PORT:-3000}" "${MONGO_PORT:-27017}"; do
  # lsof exits 1 when the port is free: `|| true` keeps set -e from ending the script.
  PROCESS="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}' || true)"
  if [[ -n "$PROCESS" && "$PROCESS" != com.docke* && "$PROCESS" != vpnkit* ]]; then
    if (( DRY_RUN )); then
      note "port $port is in use by '$PROCESS': a real run would stop here"
    else
      echo "  Port $port is in use by '$PROCESS' (pnpm dev?). Stop it, then run setup again."
      exit 1
    fi
  fi
done
run docker compose --profile stack up -d --wait

step "Database"
if (( DRY_RUN )); then
  note "would load Northwind if the database is empty (docker compose run --rm seed)"
else
  ORDERS="$(docker compose exec -T mongo mongosh --quiet "${MONGO_DB:-northwind}" \
    --eval 'db.orders.estimatedDocumentCount()' 2>/dev/null | tail -1)"
  if [[ "$ORDERS" =~ ^[0-9]+$ ]] && (( ORDERS > 0 )); then
    note "already has $ORDERS orders; keeping it (pnpm stack:seed resets it)"
  else
    run docker compose run --rm seed
  fi
fi

# ---------------------------------------------------------------------------- done
step "Done"
PORT="${AGENT_PORT:-5173}"
cat <<EOF
  The chat:        http://localhost:$PORT   (the first answer takes longer while the model loads)
  Logs:            docker compose logs -f agent
  Stop:            docker compose --profile '*' down        (the data stays)
  Start again:     docker compose --profile stack up -d --wait

  To share the chat on your local network, set AGENT_BIND=0.0.0.0 in .env and start
  again; others open http://$(scutil --get LocalHostName 2>/dev/null || echo this-mac).local:$PORT.
  There is no login: anyone on the network can ask questions (the data is read-only).
EOF
