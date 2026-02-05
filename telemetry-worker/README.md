# TentOS Telemetry Worker

Simple Cloudflare Worker to track anonymous TentOS installs.

## Quick Setup

```bash
# 1. Install wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare
wrangler login

# 3. Create KV namespace
wrangler kv:namespace create INSTALLS
# Copy the id from output

# 4. Edit wrangler.toml - paste your KV namespace id

# 5. Set admin key for viewing stats
wrangler secret put ADMIN_KEY
# Enter a secret key (e.g., a random string)

# 6. Deploy
wrangler deploy
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ping` | POST | Record install event |
| `/` | GET | Public install count |
| `/stats?key=YOUR_KEY` | GET | Detailed stats (protected) |

## View Your Stats

```
https://tentos-telemetry.YOUR-SUBDOMAIN.workers.dev/stats?key=YOUR_ADMIN_KEY
```

Returns:
```json
{
  "total_installs": 42,
  "versions": { "1.1.56": 30, "1.1.55": 12 },
  "archs": { "aarch64": 25, "x86_64": 17 },
  "installs": [...]
}
```
