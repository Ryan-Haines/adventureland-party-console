ARG NODE_IMAGE=node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /game
# The revisions come from tools/sim/pins.json through compose.yml; a build without them fails.
ARG GAME_REV
ARG COMMON_REV
ARG CONFIG_REV
RUN test -n "$GAME_REV" && test -n "$COMMON_REV" && test -n "$CONFIG_REV"
RUN git init . && git remote add origin https://github.com/kaansoral/adventureland_mongodb.git && git fetch --depth 1 origin $GAME_REV && git checkout FETCH_HEAD \
 && git clone https://github.com/kaansoral/common_engine.git common && git -C common checkout $COMMON_REV \
 && git clone https://github.com/kaansoral/adventureland_secretsandconfig.git secretsandconfig && git -C secretsandconfig checkout $CONFIG_REV
COPY backend-package-lock.json /game/package-lock.json
COPY server-package-lock.json /game/node/package-lock.json
RUN npm ci --omit=dev && cd node && npm ci --omit=dev
COPY configure.cjs boot.cjs addresses.cjs /game/e2e/
RUN node e2e/configure.cjs
CMD ["node", "e2e/boot.cjs"]
