// api/webhook.js
// Receives payment notifications from MercadoPago
// 1. Saves the order to KV for the dashboard
// 2. Subtracts purchased quantities from live stock counts
//
// HOW STOCK SUBTRACTION WORKS:
// The order summary stored in MP metadata looks like:
//   "Pay de queso x2, Cheesecake tortuga x1"
// We parse that string, find each product ID, and call DECRBY on its stock count.
// If stock hits 0, the product automatically shows as agotado on the menu.

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;

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

// Map product names back to IDs so we can find the right KV key
// This must match the data-name attributes in index.html
const NAME_TO_ID = {
    'Strudel de manzana':                    'pay-strudel-manzana',
    'Pay de queso':                          'pay-queso',
    'Pay de queso con fruta y/o chocolate':  'pay-queso-fruta-choco',
    'Pay de guayaba':                        'pay-guayaba',
    'Pay de piña':                           'pay-pina',
    'Pay de jamón con queso':                'pay-jamon-queso',
    'Pay de atún':                           'pay-atun',
    'Pay de espinacas con queso':            'pay-espinacas-queso',
    'Pay de champiñones con queso':          'pay-champinones-queso',
    'Panqué de elote':                       'panque-elote',
    'Panqué de plátano':                     'panque-platano',
    'Panqué de zanahoria':                   'panque-zanahoria',
    'Panqué de naranja':                     'panque-naranja',
    'Panqué de nuez':                        'panque-nuez',
    'Panqué marmoleado':                     'panque-marmoleado',
    'Galletas de mantequilla':               'galletas-mantequilla',
    'Galletas encaneladas':                  'galletas-encaneladas',
    'Besos de nuez':                         'besos-nuez',
    'Galletas de avena':                     'galletas-avena',
    'Brownies':                              'brownies',
    'Roles de canela':                       'roles-canela',
    'Roles de canela con topping':           'roles-canela-topping',
    'Buñuelos de aire (20 piezas)':          'bunuelos-aire',
    'Tartaleta con frutas (individual)':     'tartaleta-frutas-individual',
    'Alfajores (6 piezas)':                  'alfajores',
    'Cheesecake tortuga':                    'cheesecake-tortuga',
    'Tartaleta con frutas (entera)':         'tartaleta-frutas-entera',
    'Pastel de tres leches':                 'pastel-tres-leches',
    'Pastel de red velvet':                  'pastel-red-velvet',
    'Imposible de elote':                    'imposible-elote',
};

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).end();

    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
        try {
            // Fetch full payment details from MercadoPago
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
                headers: { 'Authorization': `Bearer ${MP_TOKEN}` },
            });
            const payment = await mpRes.json();

            if (payment.status === 'approved') {

                // ── 1. Save order to KV ───────────────────────────────────
                const order = {
                    paymentId:    payment.id,
                    status:       'approved',
                    status_label: 'pendiente',
                    total:        payment.transaction_amount,
                    summary:      payment.metadata?.order_summary || '',
                    date:         payment.metadata?.order_date || '',
                    paidAt:       payment.date_approved,
                    payerEmail:   payment.payer?.email || '',
                };
                await kv('SET', `orders:${payment.id}`, JSON.stringify(order));

                // ── 2. Subtract stock for each item ordered ───────────────
                // MercadoPago gives us the items array directly
                const items = payment.additional_info?.items || [];

                await Promise.all(items.map(async item => {
                    const productId = NAME_TO_ID[item.title];
                    if (!productId) return; // skip unknown products (e.g. test product)

                    const qty = parseInt(item.quantity, 10) || 1;

                    // DECRBY subtracts qty from current stock atomically
                    let newStock = await kv('DECRBY', `stock:current:${productId}`, qty);

                    // Never go below 0
                    if (newStock < 0) {
                        await kv('SET', `stock:current:${productId}`, '0');
                        newStock = 0;
                    }

                    console.log(`[WEBHOOK] ${item.title}: stock now ${newStock}`);
                }));
            }

        } catch (err) {
            console.error('Webhook error:', err);
        }
    }

    // Always return 200 so MercadoPago stops retrying
    return res.status(200).end();
}
