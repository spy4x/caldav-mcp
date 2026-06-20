# ── Multistage build: compile → distroless runtime ──
FROM denoland/deno:alpine AS builder

WORKDIR /app
COPY . .

# Compile to static binary
RUN deno compile -A \
  --target x86_64-unknown-linux-gnu \
  --output /tmp/caldav-mcp \
  main.ts

# ── Runtime: distroless ──
FROM gcr.io/distroless/cc-debian12

COPY --from=builder /tmp/caldav-mcp /usr/local/bin/caldav-mcp

EXPOSE 3000

ENTRYPOINT ["caldav-mcp"]
CMD ["--http"]
