#!/bin/sh
# Regera os snapshots dentro do container do Playwright (mesmo SO e fontes do CI). Ver CONTRIBUTING.
set -e
# Cópia sem node_modules/dist do host: as dependências nativas são as do Linux.
mkdir -p /work
tar -C /src --exclude=node_modules --exclude=dist --exclude=.git --exclude=.local \
  --exclude=.claude --exclude=.env --exclude='*.tsbuildinfo' -cf - . | tar -C /work -xf -
cd /work
npm ci --no-audit --no-fund
npm run build
npm run test:e2e -- --update-snapshots=all
cp -r e2e/snapshots /src/e2e/
