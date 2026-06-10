// api/stock.js
// GET  /api/stock  → returns current stock counts + daily limits (public)
// POST /api/stock  → admin actions: set_limit, adjust, reset_all
//
// KV KEY STRUCTURE:
//   stock:current:{id}  →  number  (live count, goes up/down during the day)
//   stock:limit:{id}    →  number  (daily production limit, set by owner)
//
// WHY TWO KEYS PER PRODUCT:
//   Separating limit from current stock is the core insight here.
//   "limit" is what she makes. "current" is what's left.
//   The cron job copies limit → current every morning.
//   The webhook subtracts from current when an online order lands.
//   She taps +/- in admin to adjust current when she sells in person.

const KV_URL       = process.env.KV_REST_API_URL;
const KV_TOKEN     = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.admin_secret;

async function kv(command, ...args) {
    const res = await fetch(KV_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([command, ...args]),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: return all stock data (current counts + limits) ─────────────
    // This is public — the menu needs it to show agotado badges
    if (req.method === 'GET') {
        try {
            // Get all current stock keys and limit keys in parallel
            const [currentKeys, limitKeys] = await Promise.all([
                kv('KEYS', 'stock:current:*'),
                kv('KEYS', 'stock:limit:*'),
            ]);

            const allKeys = [...(currentKeys || []), ...(limitKeys || [])];

            // Fetch all values in parallel
            const values = allKeys.length
                ? await Promise.all(allKeys.map(k => kv('GET', k)))
                : [];

            const current = {};
            const limits  = {};

            allKeys.forEach((key, i) => {
                const val = parseInt(values[i], 10);
                if (key.startsWith('stock:current:')) {
                    current[key.replace('stock:current:', '')] = isNaN(val) ? null : val;
                } else if (key.startsWith('stock:limit:')) {
                    limits[key.replace('stock:limit:', '')] = isNaN(val) ? null : val;
                }
            });

            return res.status(200).json({ ok: true, current, limits });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── POST: admin actions ───────────────────────────────────────────────
    if (req.method === 'POST') {
        const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
        if (token !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });

        const { action, id, value } = req.body;

        try {
            // ── set_limit: owner sets daily production limit ──────────────
            // e.g. "I make 2 pays de queso per day"
            // This does NOT change current stock — only the morning reset uses it
            if (action === 'set_limit') {
                const limit = Math.max(0, parseInt(value, 10) || 0);
                await kv('SET', `stock:limit:${id}`, String(limit));
                return res.status(200).json({ ok: true, id, limit });
            }

            // ── adjust: change current stock by +1 or -1 ─────────────────
            // Used when she sells in person — tap minus to subtract one unit
            // tap plus to add one back (e.g. a customer returned / cancelled)
            if (action === 'adjust') {
                const delta = parseInt(value, 10); // +1 or -1
                if (isNaN(delta)) return res.status(400).json({ ok: false, error: 'Invalid delta' });

                // INCR/DECR are atomic — safe if two requests come in simultaneously
                // This prevents the "two customers buy the last item" race condition
                let newVal;
                if (delta > 0) {
                    newVal = await kv('INCRBY', `stock:current:${id}`, delta);
                } else {
                    newVal = await kv('DECRBY', `stock:current:${id}`, Math.abs(delta));
                }

                // Never go below 0
                if (newVal < 0) {
                    await kv('SET', `stock:current:${id}`, '0');
                    newVal = 0;
                }

                return res.status(200).json({ ok: true, id, current: newVal });
            }

            // ── reset_all: cron job calls this to reset all products ──────
            // Copies each product's limit → current stock
            // Called every morning automatically
            if (action === 'reset_all') {
                const limitKeys = await kv('KEYS', 'stock:limit:*');
                if (limitKeys && limitKeys.length) {
                    const limitVals = await Promise.all(limitKeys.map(k => kv('GET', k)));
                    await Promise.all(limitKeys.map((key, i) => {
                        const productId = key.replace('stock:limit:', '');
                        const limit = limitVals[i] || '0';
                        return kv('SET', `stock:current:${productId}`, limit);
                    }));
                }
                return res.status(200).json({ ok: true, reset: limitKeys?.length || 0 });
            }

            return res.status(400).json({ ok: false, error: 'Unknown action' });

        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
