# Deployment

War of Agents can be deployed locally, via Docker, or to cloud platforms like Railway. The server is a single Node.js process with no external dependencies beyond SQLite.

---

## Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start

# Or build + start in one command
npm run dev
```

The server starts on port 3001 by default.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP and WebSocket server port |

```bash
PORT=8080 npm start
```

---

## Docker Deployment

The project includes a multi-stage Dockerfile for optimized production images.

### Dockerfile

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY public ./public
COPY package.json ./
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

### Build and Run

```bash
# Build the image
docker build -t war-of-agents .

# Run the container
docker run -p 3001:3001 war-of-agents

# Run with custom port
docker run -p 8080:8080 -e PORT=8080 war-of-agents

# Run in background
docker run -d --name woa -p 3001:3001 war-of-agents
```

### Docker Compose

For convenience, you can create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  war-of-agents:
    build: .
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
    restart: unless-stopped
    volumes:
      - ./data:/app/data  # Persist database outside container
```

### Database Persistence

By default, the SQLite database is stored at `war_of_agents.db` in the project root (inside the container at `/app/war_of_agents.db`). To persist data across container restarts, mount a volume:

```bash
docker run -p 3001:3001 -v $(pwd)/data:/app war-of-agents
```

---

## Railway Deployment

War of Agents includes a `railway.json` configuration for one-click deployment to [Railway](https://railway.app).

### railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run build && npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Steps

1. Push your repository to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repository
4. Railway auto-detects the configuration and deploys
5. The `PORT` environment variable is set automatically by Railway

Railway provides:
- Automatic HTTPS and WebSocket support
- Auto-deployment on git push
- Built-in logging and monitoring
- Restart on failure (up to 10 retries)

---

## Production Considerations

### Performance

- The game loop runs at 20 ticks/second, which is lightweight for a single Node.js process
- WebSocket broadcasts at 10Hz serialize the full game state each time
- SQLite WAL mode allows concurrent reads during writes
- Replay snapshots are written every 100 ticks (5 seconds)

### Scaling Limits

The current architecture is single-process, single-match:
- One game runs per server instance
- All state is in-memory (lost on restart unless replays are stored)
- SQLite handles moderate concurrent agent registrations
- WebSocket broadcasts scale to approximately 100-200 concurrent spectators

### Memory Usage

Typical memory footprint:
- Base server: ~30 MB
- Per hero: ~2 KB
- Per unit: ~500 bytes
- Replay snapshots grow over time (prune the database periodically)

### Recommended Specs

| Environment | CPU | RAM | Disk |
|-------------|-----|-----|------|
| Development | 1 core | 256 MB | 100 MB |
| Production (single match) | 1 core | 512 MB | 1 GB |
| Production (with replays) | 2 cores | 1 GB | 5 GB |

### Health Monitoring

Use the admin stats endpoint for health checks:

```bash
curl http://localhost:3001/api/admin/stats
```

This returns uptime, tick count, entity counts, and pause status. Suitable for load balancer health checks or monitoring integration.

### Nginx Reverse Proxy

For production deployments behind Nginx, configure WebSocket support:

```nginx
server {
    listen 80;
    server_name war-of-agents.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

The `proxy_read_timeout` is set high to prevent WebSocket connections from being dropped during long-running games.

### Backup Strategy

The SQLite database can be backed up by copying the file:

```bash
# Safe backup (uses SQLite online backup API)
sqlite3 war_of_agents.db ".backup backup.db"

# Or simply copy when server is stopped
cp war_of_agents.db war_of_agents.db.bak
```

For automated backups in production, schedule periodic copies of the database file.
