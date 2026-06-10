// api/orders.js
// GET  /api/orders  → returns all orders (admin only)
// POST /api/orders  → updates order status (admin only)

const KV_URL        = process.env.KV_REST_API_URL;
const KV_TOKEN      = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET  = process.env.admin_secret;

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

function authCheck(req) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    return token === ADMIN_SECRET;
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!authCheck(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // ── GET: return all orders ────────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            // Get all keys matching orders:*
            const keys = await kv('KEYS', 'orders:*');

            if (!keys || !keys.length) {
                return res.status(200).json({ ok: true, orders: [] });
            }

            // Fetch all order values
            const pipeline = keys.map(key => ['GET', key]);
            const results  = await Promise.all(
                keys.map(key => kv('GET', key))
            );

            const orders = results
                .map(r => {
                    try { return JSON.parse(r); } catch { return null; }
                })
                .filter(Boolean)
                .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)); // newest first

            return res.status(200).json({ ok: true, orders });

        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── POST: update order status ─────────────────────────────────────────
    if (req.method === 'POST') {
        const { paymentId, status } = req.body;

        const validStatuses = ['pendiente', 'en preparación', 'listo'];
        if (!paymentId || !validStatuses.includes(status)) {
            return res.status(400).json({ ok: false, error: 'Invalid paymentId or status' });
        }

        try {
            const raw   = await kv('GET', `orders:${paymentId}`);
            const order = JSON.parse(raw);
            order.status_label = status;
            await kv('SET', `orders:${paymentId}`, JSON.stringify(order));
            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
