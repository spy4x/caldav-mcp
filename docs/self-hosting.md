# Self-hosting

Designed for homelab deployments. Compatible with Radicale, Baïkal, Xandikos, and any CalDAV server.

## Compile to binary (recommended)

```bash
deno compile -A --output caldav-mcp https://raw.githubusercontent.com/spy4x/caldav-mcp/b249b6426f1a556ef4dada1292e3b5bf8d94d09a/main.ts
./caldav-mcp                 # stdio (for MCP clients)
./caldav-mcp --http          # HTTP on :3000 (for OpenWebUI)
```

## Docker

```yaml
services:
  caldav-mcp:
    build: https://github.com/spy4x/caldav-mcp.git#b249b6426f1a556ef4dada1292e3b5bf8d94d09a
    container_name: caldav-mcp
    restart: unless-stopped
    environment:
      - CALDAV_URL=http://radicale:5232
      - CALDAV_USERNAME=${CALDAV_USERNAME}
      - CALDAV_PASSWORD=${CALDAV_PASSWORD}
      - MCP_BEARER_TOKEN=${MCP_BEARER_TOKEN}
    ports:
      - "3000:3000"
    mem_limit: 64M
    cpus: 0.1
    networks:
      - proxy
```

Or pull pre-built image (coming soon):

```bash
docker pull ghcr.io/spy4x/caldav-mcp:latest
```

## Systemd (bare metal)

```bash
# Install binary
sudo deno compile -A --output /usr/local/bin/caldav-mcp \
  https://raw.githubusercontent.com/spy4x/caldav-mcp/b249b6426f1a556ef4dada1292e3b5bf8d94d09a/main.ts

# Systemd service
cat > /etc/systemd/system/caldav-mcp.service << 'EOF'
[Unit]
Description=caldav-mcp server
After=network.target

[Service]
ExecStart=/usr/local/bin/caldav-mcp --http
Environment=CALDAV_URL=http://localhost:5232
Environment=CALDAV_USERNAME=user
Environment=CALDAV_PASSWORD=pass
Environment=PORT=3000
Restart=always
MemoryMax=64M
CPUQuota=10%

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now caldav-mcp
```
