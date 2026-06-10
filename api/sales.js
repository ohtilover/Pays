// api/sales.js
// POST /api/sales  → log a new in-person sale (admin only)
// GET  /api/sales  → return all in-person sales (admin only)
//
// WHAT IS EVENT SOURCING?
// Instead of just updating a counter ("sold 5 today"),
// we store every individual sale as its own record:
//   sales:1718123456789  →  { product, price, qty, soldAt, source: 'presencial' }
//
// This is more powerful because later you can ask:
//   "What did I sell on Tuesday afternoons?"
//   "Which product sells more on weekends?"
//   "How much did I make in the last hour?"
// If you only stored totals, those questions are impossible to answer.
// Square, Toast, Shopify — they all do this.

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

function auth(req) {
    return (req.headers['authorization'] || '').replace('Bearer ', '').trim() === ADMIN_SECRET;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!auth(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // ── POST: log a new in-person sale ────────────────────────────────────
    if (req.method === 'POST') {
        const { productId, productName, price, qty = 1 } = req.body;

        if (!productId || !productName || !price) {
            return res.status(400).json({ ok: false, error: 'Missing required fields' });
        }

        const timestamp = Date.now();
        const sale = {
            id:          `sale-${timestamp}`,
            productId,
            productName,
            price:       Number(price),
            qty:         Number(qty),
            total:       Number(price) * Number(qty),
            soldAt:      new Date().toISOString(),
            source:      'presencial',  // distinguishes from online orders
        };

        try {
            // Save the sale event with timestamp as key
            // This naturally sorts chronologically
            await kv('SET', `sales:${timestamp}`, JSON.stringify(sale));

            // Also subtract from current stock
            // DECRBY is atomic — safe if two sales happen simultaneously
            let newStock = await kv('DECRBY', `stock:current:${productId}`, qty);
            if (newStock < 0) {
                await kv('SET', `stock:current:${productId}`, '0');
                newStock = 0;
            }

            return res.status(200).json({ ok: true, sale, newStock });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── DELETE: undo last sale ────────────────────────────────────────────
    // If she taps wrong, she can undo the last sale
    // This restores stock and removes the sale record
    if (req.method === 'DELETE') {
        const { saleId, productId, qty } = req.body;
        if (!saleId || !productId) {
            return res.status(400).json({ ok: false, error: 'Missing saleId or productId' });
        }

        try {
            // Remove the sale record
            const timestamp = saleId.replace('sale-', '');
            await kv('DEL', `sales:${timestamp}`);

            // Restore stock
            await kv('INCRBY', `stock:current:${productId}`, qty || 1);

            return res.status(200).json({ ok: true });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── GET: return all in-person sales ───────────────────────────────────
    if (req.method === 'GET') {
        try {
            const keys = await kv('KEYS', 'sales:*');
            if (!keys || !keys.length) {
                return res.status(200).json({ ok: true, sales: [] });
            }

            const values = await Promise.all(keys.map(k => kv('GET', k)));
            const sales = values
                .map(v => { try { return JSON.parse(v); } catch { return null; } })
                .filter(Boolean)
                .sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt)); // newest first

            return res.status(200).json({ ok: true, sales });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
