# syntax=docker/dockerfile:1.7
FROM rust:1.85.1-bookworm@sha256:e51d0265072d2d9d5d320f6a44dde6b9ef13653b035098febd68cce8fa7c0bc4 AS fetch
ARG LAYERFS_COMMIT=5fb68ddc1acc3163e3ac3486133bde014c5fbed3
WORKDIR /source
RUN git init && git remote add origin https://github.com/Ephemeral-AI-Lab/layerfs.git \
    && git fetch --depth=1 --filter=blob:none origin "$LAYERFS_COMMIT" \
    && git sparse-checkout init --cone \
    && git sparse-checkout set core/crates core/vendor sdk/js .cargo \
    && git checkout --detach FETCH_HEAD

# Can be overridden by BuildKit: --build-context layerfs=/absolute/pinned/checkout
FROM scratch AS layerfs
COPY --from=fetch /source/ /

FROM rust:1.85.1-bookworm@sha256:e51d0265072d2d9d5d320f6a44dde6b9ef13653b035098febd68cce8fa7c0bc4 AS native
WORKDIR /layerfs
COPY --from=layerfs / /layerfs/
COPY patches/apple-container-podman.patch /patches/apple-container-podman.patch
RUN git apply --check /patches/apple-container-podman.patch && git apply /patches/apple-container-podman.patch
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/layerfs/core/target \
    cargo build --manifest-path core/Cargo.toml --locked --release -j 4 \
      -p layerfs-node --lib -p layerfs-daemon --bins \
    && mkdir /artifacts \
    && cp core/target/release/liblayerfs_node.so /artifacts/layerfs.node \
    && cp core/target/release/layerfs-daemon /artifacts/layerfs-daemon

FROM native AS native-checks
RUN rustup component add rustfmt clippy
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/layerfs/core/target \
    cargo fmt --manifest-path core/Cargo.toml -p layerfs-sandbox -- --check \
    && timeout 120 cargo test --manifest-path core/Cargo.toml --locked -p layerfs-sandbox --all-targets \
    && timeout 120 cargo clippy --manifest-path core/Cargo.toml --locked -p layerfs-sandbox --all-targets -- -D warnings

FROM node:22-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384 AS build
WORKDIR /app
COPY package.json npm-shrinkwrap.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384 AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json upstream.lock.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=layerfs /sdk/js /opt/layerfs/sdk/js
COPY --from=layerfs /LICENSE /opt/layerfs/LICENSE
COPY --from=native /artifacts/ /opt/layerfs/
COPY docker/entrypoint.mjs /app/entrypoint.mjs
COPY examples/seed /example-seed
ENV LAYERFS_SDK_PATH=/opt/layerfs/sdk/js \
    LAYERFS_NATIVE=/opt/layerfs/layerfs.node \
    LAYERFS_DAEMON=/opt/layerfs/layerfs-daemon \
    LAYERFS_HOME=/layerfs-home \
    LAYERFS_STORE_PATH=/layerfs-store/global/store.sqlite \
    LAYERFS_DOCKER=/var/run/docker.sock
EXPOSE 8787
ENTRYPOINT ["node", "/app/entrypoint.mjs"]

# One Apple Container VM hosts one project and its Linux OCI Sandboxes.
# Podman is only the in-VM OCI executor; no Docker Engine or Docker socket.
FROM runtime AS apple-runtime
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
       podman crun catatonit uidmap iproute2 iptables curl \
    && rm -rf /var/lib/apt/lists/*
COPY apple /opt/layerfs/apple
COPY apple/containers.conf /etc/containers/containers.conf
COPY apple/storage.conf /etc/containers/storage.conf
ENV LAYERFS_ENGINE=podman LAYERFS_MCP_HOST_RUNTIME=apple-container
ENTRYPOINT ["node", "/opt/layerfs/apple/boot.mjs"]

# The default build stays the ordinary Docker runtime.
FROM runtime AS default
