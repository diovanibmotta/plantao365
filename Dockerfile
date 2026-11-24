# Imagem única (API + front): a API serve a SPA no mesmo domínio e porta.
# Build a partir da raiz do monorepo: docker build -t plantao365 .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @diovanibmotta/plantao365-shared \
  && npm run build -w @diovanibmotta/plantao365-api \
  && npm run build -w @diovanibmotta/plantao365-web

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @diovanibmotta/plantao365-api -w @diovanibmotta/plantao365-shared

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
  WEB_DIST_DIR=/repo/web
WORKDIR /repo
COPY --from=deps /repo/package.json ./
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist web
COPY apps/api/migrations apps/api/migrations
RUN mkdir -p node_modules/@diovanibmotta \
  && { test -e node_modules/@diovanibmotta/plantao365-shared || ln -s ../../packages/shared node_modules/@diovanibmotta/plantao365-shared; }
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrações não rodam automaticamente: docker run --rm <imagem> node dist/migrate.js up
CMD ["node", "dist/index.js"]
