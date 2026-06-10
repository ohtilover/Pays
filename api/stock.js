// api/stock.js
// GET  /api/stock           → returns all stock statuses (public)
// POST /api/stock           → updates a product status (admin only)

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.admin_secret;

// ── Upstash Redis REST helper ──────────────────────────────────────────────
async function kv(command, ...args) {
    const body = JSON.stringify([command, ...args]);
    const res  = await fetch(KV_URL, {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            'Content-Type':  'application/json',
        },
        body,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

// ── CORS headers ──────────────────────────────────────────────────────────
function cors(res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    cors(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ── GET: return all stock statuses ────────────────────────────────────
    if (req.method === 'GET') {
        try {
            // HGETALL pays:stock  →  { productId: "1" | "0", ... }
            const raw = await kv('HGETALL', 'pays:stock');

            // Upstash returns flat array [key, val, key, val, ...]
            const stock = {};
            if (Array.isArray(raw)) {
                for (let i = 0; i < raw.length; i += 2) {
                    stock[raw[i]] = raw[i + 1] === '1';
                }
            }
            return res.status(200).json({ ok: true, stock });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── POST: update a single product's stock status ──────────────────────
    if (req.method === 'POST') {
        // Auth check
        const auth = req.headers['authorization'] || '';
        const token = auth.replace('Bearer ', '').trim();
        if (token !== ADMIN_SECRET) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const { id, inStock } = req.body;
        if (!id || typeof inStock !== 'boolean') {
            return res.status(400).json({ ok: false, error: 'Missing id or inStock' });
        }

        try {
            await kv('HSET', 'pays:stock', id, inStock ? '1' : '0');
            return res.status(200).json({ ok: true, id, inStock });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
