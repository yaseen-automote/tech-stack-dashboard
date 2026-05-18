FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY bulk/polars/requirements.txt /tmp/polars-requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/polars-requirements.txt \
  && rm /tmp/polars-requirements.txt
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY bulk ./bulk
COPY ct ./ct
COPY lib ./lib
EXPOSE 8787
CMD ["npm", "run", "bulk:api:start"]
