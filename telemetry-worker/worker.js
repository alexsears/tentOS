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

    // GET /dashboard - Stats dashboard (protected)
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      const authKey = url.searchParams.get('key');
      if (authKey !== env.ADMIN_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(getDashboardHTML(env.ADMIN_KEY), {
        headers: { 'Content-Type': 'text/html' }
      });
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

function getDashboardHTML(apiKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TentOS Stats</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      margin-bottom: 2rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.5rem;
    }
    .stat-label { color: #8b949e; font-size: 0.875rem; margin-bottom: 0.5rem; }
    .stat-value { font-size: 2.5rem; font-weight: 600; color: #58a6ff; }
    .stat-value.green { color: #3fb950; }
    .section { margin-bottom: 2rem; }
    .section h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #8b949e; }
    .bar-chart { display: flex; flex-direction: column; gap: 0.5rem; }
    .bar-row { display: flex; align-items: center; gap: 1rem; }
    .bar-label { width: 100px; font-size: 0.875rem; text-align: right; }
    .bar-container { flex: 1; background: #21262d; border-radius: 4px; height: 24px; }
    .bar { height: 100%; background: linear-gradient(90deg, #238636, #3fb950); border-radius: 4px; transition: width 0.5s; }
    .bar-count { width: 50px; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
    .user-id { font-family: monospace; color: #8b949e; }
    .version-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      background: #238636;
      border-radius: 4px;
      font-size: 0.75rem;
    }
    .time-ago { color: #8b949e; font-size: 0.875rem; }
    .loading { text-align: center; padding: 4rem; color: #8b949e; }
    .error { color: #f85149; padding: 2rem; text-align: center; }
    .refresh-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #e6edf3;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .refresh-btn:hover { background: #30363d; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .last-updated { color: #8b949e; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TentOS Stats</h1>
      <div>
        <span class="last-updated" id="lastUpdated"></span>
        <button class="refresh-btn" onclick="loadStats()">Refresh</button>
      </div>
    </div>
    <div id="content">
      <div class="loading">Loading stats...</div>
    </div>
  </div>
  <script>
    const API_KEY = '${apiKey}';
    function timeAgo(dateStr) {
      if (!dateStr) return 'Never';
      const date = new Date(dateStr);
      const now = new Date();
      const seconds = Math.floor((now - date) / 1000);
      if (seconds < 60) return 'Just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }
    async function loadStats() {
      const content = document.getElementById('content');
      content.innerHTML = '<div class="loading">Loading stats...</div>';
      try {
        const res = await fetch('/stats?key=' + API_KEY);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        renderStats(data);
        document.getElementById('lastUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
      } catch (e) {
        content.innerHTML = '<div class="error">Failed to load stats: ' + e.message + '</div>';
      }
    }
    function renderStats(data) {
      const content = document.getElementById('content');
      const versions = Object.entries(data.versions || {}).sort((a, b) => b[1] - a[1]);
      const archs = Object.entries(data.archs || {}).sort((a, b) => b[1] - a[1]);
      const maxVersion = Math.max(...versions.map(v => v[1]), 1);
      const maxArch = Math.max(...archs.map(a => a[1]), 1);
      content.innerHTML = \`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Users</div>
            <div class="stat-value">\${data.total_users || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active (24h)</div>
            <div class="stat-value green">\${data.active_24h || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active (7d)</div>
            <div class="stat-value green">\${data.active_7d || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active (30d)</div>
            <div class="stat-value green">\${data.active_30d || 0}</div>
          </div>
        </div>
        <div class="section">
          <h2>Versions</h2>
          <div class="bar-chart">
            \${versions.map(([v, count]) => \`
              <div class="bar-row">
                <div class="bar-label">\${v}</div>
                <div class="bar-container">
                  <div class="bar" style="width: \${(count / maxVersion) * 100}%"></div>
                </div>
                <div class="bar-count">\${count}</div>
              </div>
            \`).join('')}
          </div>
        </div>
        <div class="section">
          <h2>Architectures</h2>
          <div class="bar-chart">
            \${archs.map(([a, count]) => \`
              <div class="bar-row">
                <div class="bar-label">\${a}</div>
                <div class="bar-container">
                  <div class="bar" style="width: \${(count / maxArch) * 100}%"></div>
                </div>
                <div class="bar-count">\${count}</div>
              </div>
            \`).join('')}
          </div>
        </div>
        <div class="section">
          <h2>Recent Users</h2>
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Version</th>
                <th>Arch</th>
                <th>First Seen</th>
                <th>Last Active</th>
                <th>Startups</th>
              </tr>
            </thead>
            <tbody>
              \${(data.users || []).slice(0, 20).map(u => \`
                <tr>
                  <td class="user-id">\${u.id}</td>
                  <td><span class="version-badge">\${u.version || '?'}</span></td>
                  <td>\${u.arch || '?'}</td>
                  <td class="time-ago">\${timeAgo(u.first_seen)}</td>
                  <td class="time-ago">\${timeAgo(u.last_seen)}</td>
                  <td>\${(u.events || []).length}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
      \`;
    }
    loadStats();
    setInterval(loadStats, 60000);
  </script>
</body>
</html>`;
}
