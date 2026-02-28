FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux git curl ca-certificates python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://openfang.sh/install | sh

RUN ln -sf /root/.openfang/bin/openfang /usr/local/bin/openfang-real

COPY openfang-wrapper.sh /usr/local/bin/openfang
RUN chmod +x /usr/local/bin/openfang

RUN npm install -g @openai/codex

RUN openfang init --non-interactive \
    && openfang config set api_listen 127.0.0.1:4201 \
    && openfang config set default_model.provider ollama \
    && openfang config set default_model.model llama3.2 \
    && openfang config unset default_model.api_key_env

RUN mkdir -p /workspace /workspace/swarm

COPY openfang-port-proxy.js /usr/local/bin/openfang-port-proxy.js
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
