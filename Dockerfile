FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/root/.dotnet:/root/.cargo/bin:${PATH}" \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates build-essential pkg-config libssl-dev \
    python3 python3-pip \
    nodejs npm \
    default-jdk \
    gcc g++ \
    lua5.4 \
    && ln -sf /usr/bin/lua5.4 /usr/bin/lua \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN npm install -g typescript tsx

RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- -c 10.0

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable

COPY . /app
WORKDIR /app/backend

RUN cargo build --release

EXPOSE 3000

CMD ["./target/release/simplelanguages"]
