// api/create-preference.js
// POST /api/create-preference
// Creates a MercadoPago checkout preference and returns the checkout URL

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const { items, total, date } = req.body;

    if (!items || !items.length) {
        return res.status(400).json({ ok: false, error: 'No items in order' });
    }

    const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_TOKEN) {
        return res.status(500).json({ ok: false, error: 'Payment not configured' });
    }

    // Build MercadoPago items array
    const mpItems = items.map(item => ({
        id:          item.id,
        title:       item.name,
        quantity:    item.qty,
        unit_price:  item.price,
        currency_id: 'MXN',
    }));

    // Build description for the order notification
    const orderSummary = items
        .map(i => `${i.name} x${i.qty}`)
        .join(', ');

    const dateNote = date ? ` | Fecha: ${date}` : '';

    const preference = {
        items: mpItems,
        back_urls: {
            success: `https://pays-hazel.vercel.app/success.html`,
            failure: `https://pays-hazel.vercel.app/`,
            pending: `https://pays-hazel.vercel.app/`,
        },
        auto_return: 'approved',
        statement_descriptor: 'El hada de los pays',
        external_reference: `pedido-${Date.now()}`,
        metadata: {
            order_summary: orderSummary + dateNote,
            order_date:    date || 'No especificada',
            total_mxn:     total,
        },
        notification_url: `https://pays-hazel.vercel.app/api/webhook`,
        payment_methods: {
            excluded_payment_types: [],
            installments: 1,
        },
    };

    try {
        const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${MP_TOKEN}`,
            },
            body: JSON.stringify(preference),
        });

        const data = await mpRes.json();

        if (!mpRes.ok) {
            console.error('MercadoPago error:', data);
            return res.status(500).json({ ok: false, error: data.message || 'MP error' });
        }

        return res.status(200).json({
            ok:          true,
            checkoutUrl: data.init_point,
            preferenceId: data.id,
        });

    } catch (err) {
        console.error('Fetch error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}
