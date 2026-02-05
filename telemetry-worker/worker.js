/**
 * TentOS Telemetry Worker
 * Deploy to Cloudflare Workers to track anonymous installs
 *
 * Setup:
 * 1. npm create cloudflare@latest tentos-telemetry
 * 2. Replace src/index.js with this file
 * 3. Create KV namespace: wrangler kv:namespace create INSTALLS
 * 4. Add to wrangler.toml: [[kv_namespaces]] binding = "INSTALLS" id = "your-id"
 * 5. Deploy: wrangler deploy
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // POST /ping - Record install/event
    if (request.method === 'POST' && url.pathname === '/ping') {
      try {
        const data = await request.json();
        const { id, event, version, arch, timestamp } = data;

        if (!id) {
          return new Response(JSON.stringify({ error: 'Missing id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Get existing record or create new
        const existing = await env.INSTALLS.get(id, 'json') || {
          first_seen: timestamp || new Date().toISOString(),
          events: []
        };

        // Update record
        existing.last_seen = timestamp || new Date().toISOString();
        existing.version = version;
        existing.arch = arch;
        existing.events.push({
          type: event,
          time: timestamp || new Date().toISOString()
        });

        // Keep only last 10 events
        if (existing.events.length > 10) {
          existing.events = existing.events.slice(-10);
        }

        // Store with 1 year expiry
        await env.INSTALLS.put(id, JSON.stringify(existing), {
          expirationTtl: 365 * 24 * 60 * 60
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /stats - Get install statistics (protected with simple key)
    if (request.method === 'GET' && url.pathname === '/stats') {
      const authKey = url.searchParams.get('key');
      if (authKey !== env.ADMIN_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        const list = await env.INSTALLS.list();
        const installs = [];
        const versions = {};
        const archs = {};
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        let active24h = 0, active7d = 0, active30d = 0;

        for (const key of list.keys) {
          const data = await env.INSTALLS.get(key.name, 'json');
          if (data) {
            installs.push({
              id: key.name,
              ...data
            });

            // Count versions
            if (data.version) {
              versions[data.version] = (versions[data.version] || 0) + 1;
            }
            // Count architectures
            if (data.arch) {
              archs[data.arch] = (archs[data.arch] || 0) + 1;
            }
            // Active users
            if (data.last_seen) {
              const lastSeen = new Date(data.last_seen).getTime();
              if (now - lastSeen < day) active24h++;
              if (now - lastSeen < 7 * day) active7d++;
              if (now - lastSeen < 30 * day) active30d++;
            }
          }
        }

        return new Response(JSON.stringify({
          total_users: installs.length,
          active_24h: active24h,
          active_7d: active7d,
          active_30d: active30d,
          versions,
          archs,
          users: installs.sort((a, b) =>
            new Date(b.last_seen) - new Date(a.last_seen)
          )
        }, null, 2), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET / - Simple status
    if (request.method === 'GET' && url.pathname === '/') {
      try {
        const list = await env.INSTALLS.list();
        return new Response(JSON.stringify({
          service: 'TentOS Telemetry',
          total_installs: list.keys.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ service: 'TentOS Telemetry', status: 'ok' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
