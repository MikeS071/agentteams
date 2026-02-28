FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux git curl ca-certificates python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://openfang.sh/install | sh

RUN mv /root/.openfang/bin/openfang /root/.openfang/bin/openfang-real
COPY openfang-wrapper.sh /usr/local/bin/openfang
COPY openfang-proxy.js /usr/local/bin/openfang-proxy.js
RUN chmod +x /usr/local/bin/openfang

ENV PATH="/usr/local/bin:/root/.openfang/bin:${PATH}"

RUN openfang init --non-interactive
RUN sed -i 's/api_listen = "127.0.0.1:4200"/api_listen = "127.0.0.1:4201"/' /root/.openfang/config.toml

RUN npm install -g @openai/codex

RUN mkdir -p /workspace /workspace/swarm

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:4200/healthz || exit 1

ENV TENANT_ID="" \
    PLATFORM_API_URL="" \
    PLATFORM_API_KEY="" \
    LLM_PROXY_URL=""

WORKDIR /workspace
EXPOSE 4200

ENTRYPOINT ["entrypoint.sh"]
