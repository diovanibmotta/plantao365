#!/bin/sh
# Uso: DATABASE_URL=postgres://... sh .github/scripts/smoke-image.sh <imagem>
# Verifica que a imagem importa o módulo de plugins, sobe e responde /health.
# Usa a rede do host (Linux): o Postgres e a porta 3000 são os da máquina.
set -eu
image="$1"
name="smoke-$$"

docker run --rm "$image" node -e "import('./dist/plugins/index.js')"

trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$name" --network host \
  -e NODE_ENV=development -e PORT=3000 -e DATABASE_URL="$DATABASE_URL" "$image" >/dev/null

for _ in $(seq 30); do
  # De dentro do container: não confunde com outro processo na porta 3000.
  if docker exec "$name" node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "ok: $image"
    exit 0
  fi
  sleep 1
done

echo "falha: $image não respondeu /health" >&2
docker logs "$name" >&2
exit 1
