# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS node-jdk

RUN apt-get update \
    && apt-get install --no-install-recommends -y openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM node-jdk AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS test

COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY examples ./examples

RUN npm run build \
    && npm test

CMD ["npm", "test"]

FROM node-jdk AS production-dependencies

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

FROM production-dependencies AS runtime

ENV NODE_ENV=production \
    RUNS_DIR=/app/runs \
    DEEPSEEK_BASE_URL=https://api.deepseek.com \
    DEEPSEEK_MODEL=deepseek-v4-pro \
    MODEL_TIMEOUT_MS=120000 \
    JAVAC_TIMEOUT_MS=30000

COPY --from=test --chown=node:node /app/dist/src ./dist/src
COPY --chown=node:node examples ./examples

RUN mkdir -p /app/runs /app/examples/output \
    && chown -R node:node /app/runs /app/examples/output

USER node

ENTRYPOINT ["node", "dist/src/apps/cli/main.js"]
CMD ["migrate-one", "examples/cobol/HELLO.cob", "examples/output", "Hello", "5"]
