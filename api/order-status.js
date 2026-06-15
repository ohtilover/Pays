// api/order-status.js
// GET /api/order-status?id=PAYMENT_ID
//
// PUBLIC endpoint — no password needed.
// Customers use this to check their order status after paying.
//
// SECURITY NOTE: we only return the minimal info needed (status, items,
// total, date). We do NOT return the customer's email or other orders.
// Someone would need the exact payment ID (from their confirmation page)
// to look up a specific order — IDs are long random numbers from
// MercadoPago, not guessable.

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store'); // always fetch fresh status

    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, error: 'Missing order id' });

    try {
        const raw = await kv('GET', `orders:${id}`);
        if (!raw) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' });

        const order = JSON.parse(raw);

        // Return only what the customer needs to see
        return res.status(200).json({
            ok:      true,
            status:  order.status_label || 'pendiente',
            summary: order.summary || '',
            total:   order.total || 0,
            date:    order.date || '',
            paidAt:  order.paidAt || '',
        });

    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
