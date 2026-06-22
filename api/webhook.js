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

const KV_URL        = process.env.KV_REST_API_URL;
const KV_TOKEN      = process.env.KV_REST_API_TOKEN;
const MP_TOKEN      = process.env.MP_ACCESS_TOKEN;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL  = process.env.NOTIFICATION_EMAIL;  // mom's email
const FROM_EMAIL    = process.env.RESEND_FROM_EMAIL;   // verified sender in Resend

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

                // ── 3. Email notification to owner ────────────────────────
                await sendOrderEmail(order).catch(err =>
                    console.error('[WEBHOOK] Email failed:', err)
                );
            }

        } catch (err) {
            console.error('Webhook error:', err);
        }
    }

    // Always return 200 so MercadoPago stops retrying
    return res.status(200).end();
}

async function sendOrderEmail(order) {
    if (!RESEND_KEY || !NOTIFY_EMAIL || !FROM_EMAIL) return;

    const itemLines = order.summary
        ? order.summary.split(',').map(i =>
            `<li style="padding:5px 0;font-size:14px;color:#2A1A35;">${i.trim()}</li>`
          ).join('')
        : `<li style="padding:5px 0;font-size:14px;color:#2A1A35;">Ver detalle en el panel</li>`;

    const dateRow = order.date && order.date !== 'No especificada'
        ? `<tr>
               <td style="padding:10px 0;font-size:13px;color:rgba(42,26,53,0.5);border-bottom:1px solid rgba(180,143,212,0.15);">Fecha del pedido</td>
               <td style="padding:10px 0;font-size:13px;font-weight:600;color:#2A1A35;text-align:right;border-bottom:1px solid rgba(180,143,212,0.15);">📅 ${order.date}</td>
           </tr>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:24px;background:#FAF7FB;font-family:Inter,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;padding:32px;border:1px solid rgba(180,143,212,0.2);">

    <p style="font-size:36px;margin:0 0 12px;">🥧</p>
    <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;color:#2A1A35;">¡Nuevo pedido!</h1>
    <p style="font-size:14px;color:rgba(42,26,53,0.5);margin:0 0 28px;line-height:1.5;">
      Se acaba de confirmar un pago en <strong>El hada de los pays</strong>.
    </p>

    <div style="background:#FAF7FB;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:rgba(42,26,53,0.4);margin:0 0 10px;">Productos</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7;">${itemLines}</ul>
    </div>

    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:10px 0;font-size:13px;color:rgba(42,26,53,0.5);border-bottom:1px solid rgba(180,143,212,0.15);">Total pagado</td>
        <td style="padding:10px 0;font-size:16px;font-weight:700;color:#2A1A35;text-align:right;border-bottom:1px solid rgba(180,143,212,0.15);">MX$${order.total}</td>
      </tr>
      ${dateRow}
      <tr>
        <td style="padding:10px 0;font-size:13px;color:rgba(42,26,53,0.5);">Referencia</td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#2A1A35;text-align:right;">#${String(order.paymentId).slice(-6)}</td>
      </tr>
    </table>

    <p style="margin:28px 0 0;font-size:12px;color:rgba(42,26,53,0.35);text-align:center;line-height:1.6;">
      Abre el panel de administración para actualizar el estado del pedido.
    </p>
  </div>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            from:    `El hada de los pays <${FROM_EMAIL}>`,
            to:      [NOTIFY_EMAIL],
            subject: `🥧 Nuevo pedido — MX$${order.total}`,
            html,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend ${res.status}: ${body}`);
    }
}
