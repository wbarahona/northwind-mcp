#!/usr/bin/env bash
# pnpm stack:smoke: builds and starts a throwaway copy of the stack (its own Compose project,
# Mongo, volume and ports), seeds it, checks the API and the MCP server against it, then
# removes it. The development Mongo and its data are never touched.
#
#   KEEP=1 pnpm stack:smoke   leave the smoke stack running afterwards (prints how to remove it)
#
# Note: with `set -o pipefail`, never pipe into `grep -q` (it exits early and the pipeline
# fails); capture the output first and test it.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=northwind-smoke
export API_PORT="${SMOKE_API_PORT:-3118}"
export MONGO_PORT="${SMOKE_MONGO_PORT:-27118}"
export MONGO_DB=northwind
export AGENT_PORT="${SMOKE_AGENT_PORT:-5118}"
export API_KEYS="smoke-$(date +%s)-${RANDOM}"
export NORTHWIND_API_KEY="$API_KEYS"
# No model in the smoke test (see scripts/compose.smoke.yml): the chat must say so clearly.
export COMPOSE_FILE=docker-compose.yml:scripts/compose.smoke.yml
export SEED_ANCHOR_DATE=2026-10-22
API="http://127.0.0.1:${API_PORT}"
AGENT="http://127.0.0.1:${AGENT_PORT}"

FAILED=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected $3, got $2)"; fi; }

cleanup() {
  if [[ "${KEEP:-}" == 1 ]]; then
    printf '\nSmoke stack left running at %s (API key %s). Remove it with:\n' "$API" "$API_KEYS"
    echo "  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} docker compose --profile '*' down -v"
  else
    step "Removing the smoke stack"
    docker compose --profile '*' down -v --remove-orphans >/dev/null 2>&1 &&
      echo "  removed its containers, network and volume"
  fi
}
trap cleanup EXIT

json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(eval("JSON.parse(s)."+process.argv[1]))}catch{console.log("unreadable")}})' "$1"; }
http_code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
wait_healthy() {
  for _ in $(seq 1 60); do
    [[ "$(http_code "$API/health")" == 200 ]] && return 0
    sleep 1
  done
  return 1
}

step "Building the images"
if build_output="$(docker compose --profile stack --profile seed build 2>&1)"; then
  ok "api, seed and agent built"
else
  echo "$build_output" | tail -40
  bad "docker compose build failed"
  exit 1
fi

step "Starting a fresh stack (project ${COMPOSE_PROJECT_NAME}, API on ${API}, chat on ${AGENT})"
if up_output="$(docker compose --profile stack up -d --wait --quiet-pull 2>&1)"; then
  ok "mongo, api and agent healthy"
else
  echo "$up_output" | tail -20
  docker compose logs --tail 30 api 2>&1 || true
  bad "the stack did not become healthy"
  exit 1
fi

step "Seeding (anchor ${SEED_ANCHOR_DATE})"
seed_output="$(docker compose run --rm seed 2>&1)"
if [[ "$seed_output" == *"Done in"* && "$seed_output" == *"Order "*"830"* ]]; then
  ok "830 orders loaded"
else
  bad "seed failed"
  echo "$seed_output" | tail -20
fi

step "API"
health="$(curl -fsS "$API/health" || true)"
if [[ "$health" == *'"status":"ok"'* && "$health" == *'"mongodb":{'*'"status":"up"'* ]]; then ok "/health: ok, database up"; else bad "/health: $health"; fi
check "ORD-10248 total" "$(curl -fsS -H "x-api-key: ${API_KEYS}" "$API/v1/orders/ORD-10248" | json_field totals.total)" "472.38"
check "a request without the key is refused" "$(http_code "$API/v1/orders/ORD-10248")" "401"
check "/openapi.json is served" "$(http_code "$API/openapi.json")" "200"
check "the API listens on localhost only" "$(docker compose port api 3000)" "127.0.0.1:${API_PORT}"
check "the API runs as the node user" "$(docker compose exec -T api id -un)" "node"

step "MCP server over stdio, against the containerised API"
pnpm --silent turbo run build --filter=@northwind/mcp --output-logs=errors-only >/dev/null
if NORTHWIND_API_URL="$API" NORTHWIND_API_KEY="$API_KEYS" node apps/mcp/scripts/stack-smoke.mjs; then :; else FAILED=1; fi

step "Chat agent"
page_headers="$(curl -sS -D - -o /dev/null "$AGENT/")"
page="$(curl -fsS "$AGENT/" || true)"
if [[ "$page" == *'<div id="root">'* ]]; then ok "the chat page is served"; else bad "the chat page is missing"; fi
if [[ "$page_headers" == *"default-src 'self'"* && "$page_headers" == *"frame-ancestors 'none'"* ]]; then
  ok "with its Content-Security-Policy"
else
  bad "no Content-Security-Policy on the page"
fi
tools="$(curl -fsS "$AGENT/api/tools" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).tools.map(t=>t.name);const w=n.filter(x=>/^(place|update|add|remove|ship)_/.test(x));console.log(n.length+(w.length?" WRITE:"+w:""))})')"
check "the agent offers the 14 read-only tools, no write tools" "$tools" "14"
check "/healthz reports the model as down" "$(curl -fsS "$AGENT/healthz" | json_field llm)" "down"
chat="$(curl -sS -X POST -H 'content-type: application/json' -d '{"question":"What is in order 10248?"}' "$AGENT/api/chat")"
if [[ "$chat" == *'"type":"error"'*"not reachable"* ]]; then ok "a chat without a model says the model server is not reachable"; else bad "unexpected chat answer: $chat"; fi
check "/api/call is gone" "$(http_code -X POST -H 'content-type: application/json' -d '{}' "$AGENT/api/call")" "404"
check "the agent listens on localhost only" "$(docker compose port agent 5173)" "127.0.0.1:${AGENT_PORT}"
check "the agent runs as the node user" "$(docker compose exec -T agent id -un)" "node"

step "Restarting Mongo: the API recovers by itself"
docker compose restart mongo >/dev/null 2>&1
if wait_healthy; then ok "healthy again"; else bad "the API did not recover within 60 s"; fi
check "reads work after the restart" "$(curl -fsS -H "x-api-key: ${API_KEYS}" "$API/v1/orders/ORD-10248" | json_field code)" "ORD-10248"

step "Images"
for image in api seed agent; do
  size="$(docker image inspect "northwind/${image}:local" --format '{{.Size}}')"
  printf '  %s: %s MB\n' "$image" "$((size / 1000 / 1000))"
done

if [[ "$FAILED" == 0 ]]; then
  printf '\n\033[32mSmoke test passed.\033[0m\n'
else
  printf '\n\033[31mSmoke test failed.\033[0m See the ✗ lines above.\n'
fi
exit "$FAILED"
