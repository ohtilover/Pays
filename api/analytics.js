// api/analytics.js
// GET /api/analytics → returns aggregated stats from BOTH online orders and in-person sales
//
// KEY CONCEPT: merging two data sources
// Online orders live in keys:  orders:{paymentId}
// In-person sales live in keys: sales:{timestamp}
// Analytics reads both and combines them into one unified picture.
// This is how every real business intelligence tool works —
// it pulls from multiple sources and presents a single view.

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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (token !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    try {
        // ── STEP 1: Fetch online orders AND in-person sales in parallel ────
        const [orderKeys, saleKeys] = await Promise.all([
            kv('KEYS', 'orders:*'),
            kv('KEYS', 'sales:*'),
        ]);

        const [orderValues, saleValues] = await Promise.all([
            orderKeys?.length ? Promise.all(orderKeys.map(k => kv('GET', k))) : Promise.resolve([]),
            saleKeys?.length  ? Promise.all(saleKeys.map(k => kv('GET', k)))  : Promise.resolve([]),
        ]);

        // Parse both into unified transaction objects
        const parse = v => { try { return JSON.parse(v); } catch { return null; } };

        const orders = orderValues.map(parse).filter(Boolean);
        const sales  = saleValues.map(parse).filter(Boolean);

        // ── STEP 2: Build unified transaction list ────────────────────────
        // Normalize both into the same shape so we can process them together:
        // { total, date, source, items: [{ name, qty }] }
        const transactions = [
            ...orders.map(o => ({
                total:  o.total || 0,
                date:   o.paidAt ? o.paidAt.slice(0, 10) : null,
                source: 'online',
                items:  parseSummary(o.summary || ''),
            })),
            ...sales.map(s => ({
                total:  s.total || 0,
                date:   s.soldAt ? s.soldAt.slice(0, 10) : null,
                source: 'presencial',
                items:  [{ name: s.productName, qty: s.qty || 1 }],
            })),
        ].filter(t => t.date);

        // ── STEP 3: Compute totals ─────────────────────────────────────────
        const totalRevenue    = transactions.reduce((s, t) => s + t.total, 0);
        const totalOrders     = orders.length;
        const totalSales      = sales.length;
        const averageOrder    = (totalOrders + totalSales) > 0
            ? Math.round(totalRevenue / (totalOrders + totalSales)) : 0;

        // Online vs presencial breakdown
        const onlineRevenue      = orders.reduce((s, o) => s + (o.total || 0), 0);
        const presencialRevenue  = sales.reduce((s, v) => s + (v.total || 0), 0);

        // ── STEP 4: Revenue by day (last 7 days) ──────────────────────────
        const last7Days = buildEmptyDays();
        transactions.forEach(t => {
            if (last7Days[t.date] !== undefined) {
                last7Days[t.date] += t.total;
            }
        });

        // ── STEP 5: Top products (combined online + presencial) ───────────
        const productCounts = {};
        transactions.forEach(t => {
            t.items.forEach(item => {
                if (!item.name) return;
                productCounts[item.name] = (productCounts[item.name] || 0) + (item.qty || 1);
            });
        });

        const topProducts = Object.entries(productCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        // ── STEP 6: Today's breakdown ─────────────────────────────────────
        const todayKey = new Date().toISOString().slice(0, 10);
        const todayOnline     = orders.filter(o => o.paidAt?.slice(0,10) === todayKey)
                                      .reduce((s, o) => s + (o.total || 0), 0);
        const todayPresencial = sales.filter(s => s.soldAt?.slice(0,10) === todayKey)
                                     .reduce((s, v) => s + (v.total || 0), 0);

        return res.status(200).json({
            ok: true,
            totalRevenue,
            totalOrders,
            totalSales,
            averageOrder,
            onlineRevenue,
            presencialRevenue,
            todayOnline,
            todayPresencial,
            last7Days,
            topProducts,
        });

    } catch (err) {
        console.error('Analytics error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

// Parse "Pay de queso x2, Cheesecake x1" → [{ name, qty }]
function parseSummary(summary) {
    return summary.split(',').map(chunk => {
        const match = chunk.trim().match(/^(.+?)\s+x(\d+)$/);
        return match ? { name: match[1].trim(), qty: parseInt(match[2], 10) } : null;
    }).filter(Boolean);
}

function buildEmptyDays() {
    const days = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days[d.toISOString().slice(0, 10)] = 0;
    }
    return days;
}
