ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /game
ARG GAME_REV=90052162eb3ebda36c893e1eb4af643913c8f984
ARG COMMON_REV=fa74fabf5d3782503712621e037bfb934ecb8439
ARG CONFIG_REV=6b3493be30abe367cfaf879a2d5ad370742e0866
RUN git init . && git remote add origin https://github.com/kaansoral/adventureland_mongodb.git && git fetch --depth 1 origin $GAME_REV && git checkout FETCH_HEAD \
 && git clone https://github.com/kaansoral/common_engine.git common && git -C common checkout $COMMON_REV \
 && git clone https://github.com/kaansoral/adventureland_secretsandconfig.git secretsandconfig && git -C secretsandconfig checkout $CONFIG_REV
COPY backend-package-lock.json /game/package-lock.json
COPY server-package-lock.json /game/node/package-lock.json
RUN npm ci --omit=dev && cd node && npm ci --omit=dev
COPY configure.cjs boot.cjs /game/e2e/
RUN node e2e/configure.cjs
CMD ["node", "e2e/boot.cjs"]
