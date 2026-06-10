// api/analytics.js
// GET /api/analytics  → returns aggregated order stats (admin only)
//
// WHAT THIS FILE DOES:
// 1. Reads every order stored in Upstash (same data the dashboard shows)
// 2. Loops through them and computes totals, averages, trends
// 3. Returns clean numbers ready for the frontend to display
//
// This pattern is called "server-side aggregation" — you do the math
// on the server so the browser only receives what it needs to show.

const KV_URL       = process.env.KV_REST_API_URL;
const KV_TOKEN     = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.admin_secret;

// Reusable KV helper — sends a Redis command to Upstash via HTTP
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
    // CORS headers — allow the browser to call this API
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Auth check — only the admin can see analytics
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (token !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    try {
        // ── STEP 1: Get all order keys from Upstash ───────────────────────
        // KEYS 'orders:*' returns every key that starts with 'orders:'
        // e.g. ['orders:123', 'orders:456', 'orders:789']
        const keys = await kv('KEYS', 'orders:*');

        if (!keys || !keys.length) {
            // No orders yet — return zeros
            return res.status(200).json({
                ok: true,
                totalRevenue:   0,
                totalOrders:    0,
                averageOrder:   0,
                last7Days:      buildEmptyDays(),
                topProducts:    [],
            });
        }

        // ── STEP 2: Fetch every order in parallel ─────────────────────────
        // Promise.all runs all fetches at the same time instead of one by one
        // This is faster — 50 orders fetched in 1 round trip instead of 50
        const rawOrders = await Promise.all(keys.map(key => kv('GET', key)));

        // Parse JSON strings into objects, filter out any nulls
        const orders = rawOrders
            .map(r => { try { return JSON.parse(r); } catch { return null; } })
            .filter(o => o && o.status !== 'refunded');

        // ── STEP 3: Compute totals ────────────────────────────────────────
        // reduce() is JavaScript's way of "folding" an array into one value
        // Here we're adding up all the totals: [400, 130, 160] → 690
        const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
        const totalOrders  = orders.length;
        const averageOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

        // ── STEP 4: Revenue by day for the last 7 days ───────────────────
        // We want to show a bar chart: Mon MX$0, Tue MX$260, Wed MX$400...
        // Build a map of { 'YYYY-MM-DD': totalRevenue }
        const last7Days = buildEmptyDays(); // starts with 7 days of zeros

        orders.forEach(order => {
            if (!order.paidAt) return;
            const day = order.paidAt.slice(0, 10); // 'YYYY-MM-DD'
            if (last7Days[day] !== undefined) {
                last7Days[day] += (order.total || 0);
            }
        });

        // ── STEP 5: Top products ──────────────────────────────────────────
        // Parse the summary string to count how many times each product appears
        // summary looks like: "Cheesecake tortuga x1, Pay de queso x2"
        const productCounts = {};

        orders.forEach(order => {
            if (!order.summary) return;
            // Split by comma, then parse each "Name xQty" chunk
            order.summary.split(',').forEach(chunk => {
                const match = chunk.trim().match(/^(.+?)\s+x(\d+)$/);
                if (match) {
                    const name = match[1].trim();
                    const qty  = parseInt(match[2], 10);
                    productCounts[name] = (productCounts[name] || 0) + qty;
                }
            });
        });

        // Sort by count descending, take top 5
        const topProducts = Object.entries(productCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

        // ── STEP 6: Return everything ─────────────────────────────────────
        return res.status(200).json({
            ok:           true,
            totalRevenue,
            totalOrders,
            averageOrder,
            last7Days,    // { 'YYYY-MM-DD': revenue, ... }
            topProducts,  // [{ name, count }, ...]
        });

    } catch (err) {
        console.error('Analytics error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

// ── Helper: build last 7 days as { 'YYYY-MM-DD': 0 } ─────────────────────
// We pre-fill with zeros so days with no orders still show up in the chart
function buildEmptyDays() {
    const days = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
        days[key] = 0;
    }
    return days;
}
