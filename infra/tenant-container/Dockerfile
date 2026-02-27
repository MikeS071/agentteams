FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux git curl ca-certificates python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace /workspace/swarm

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD curl -f http://localhost:4200/health || exit 1

ENV TENANT_ID="" \
    PLATFORM_API_URL="" \
    PLATFORM_API_KEY="" \
    LLM_PROXY_URL=""

WORKDIR /workspace
EXPOSE 4200

ENTRYPOINT ["entrypoint.sh"]
