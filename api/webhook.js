// api/webhook.js
// Receives payment notifications from MercadoPago
// Logs confirmed payments to Upstash so the owner can see them

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

async function kvSet(key, value) {
    await fetch(KV_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${KV_TOKEN}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify(['SET', key, JSON.stringify(value)]),
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).end();

    const { type, data } = req.body;

    // MercadoPago sends payment notifications
    if (type === 'payment' && data?.id) {
        try {
            // Fetch payment details from MP
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MP_TOKEN}` },
            });
            const payment = await mpRes.json();

            if (payment.status === 'approved') {
                const order = {
                    paymentId:    payment.id,
                    status:       'approved',
                    total:        payment.transaction_amount,
                    summary:      payment.metadata?.order_summary || '',
                    date:         payment.metadata?.order_date || '',
                    paidAt:       payment.date_approved,
                    payerEmail:   payment.payer?.email || '',
                };

                // Store in KV with timestamp key
                await kvSet(`orders:${payment.id}`, order);
            }
        } catch (err) {
            console.error('Webhook error:', err);
        }
    }

    // Always return 200 to MP so it stops retrying
    return res.status(200).end();
}
