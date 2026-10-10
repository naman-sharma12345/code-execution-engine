FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j2

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ python3 nodejs default-jdk-headless && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/aetherrun /usr/local/bin/aetherrun
COPY --from=build /src/data /opt/aether/data
ENV AETHER_PROBLEMS=/opt/aether/data/problems.json AETHER_HOST=0.0.0.0 AETHER_PORT=3001
EXPOSE 3001
USER nobody
CMD ["aetherrun"]
