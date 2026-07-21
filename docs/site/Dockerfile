# Runtime image for the docs site — the ARTIFACT deploys, the image never builds docs.
# Build context is docs/ (the file: docgen dep lives beside site/):
#
#   cd docs && docker build -f site/Dockerfile -t effect-pm-docs .
#
# Expects these to exist locally BEFORE the docker build (produced by `pnpm build` in site/,
# which chains gen-api → gen-hovers → gen-search → gen-llms → check-links):
#   site/dist  site/api-data  site/api-hovers  site/public

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
# manifest + the file: docgen dependency (source-consumed)
COPY site/package.json site/pnpm-lock.yaml ./site/
COPY docgen ./docgen
WORKDIR /app/site
RUN pnpm install --prod --frozen-lockfile \
  && find node_modules -type f \( -name "*.map" -o -name "*.md" -o -name "CHANGELOG*" \) -delete

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/site
COPY --from=deps /app/site/node_modules ./node_modules
COPY --from=deps /app/docgen /app/docgen
COPY site/package.json ./
# the artifact: server+client bundles (incl. dist/public assets), API model, hover sidecars
COPY site/dist ./dist
COPY site/api-data ./api-data
COPY site/api-hovers ./api-hovers
EXPOSE 8080
# PORT is App Platform's contract; waku start serves dist/ from cwd
CMD ["sh", "-c", "./node_modules/.bin/waku start --host 0.0.0.0 --port ${PORT:-8080}"]
