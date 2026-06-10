// api/cron.js
// Runs every morning at 9:00 AM Mexico City time (UTC-6 = 15:00 UTC)
// Resets all product stock counts back to their daily limits
//
// WHAT IS A CRON JOB?
// A cron job is a piece of code that runs automatically on a schedule —
// no human triggers it. The name comes from "chronos" (time in Greek).
// You see cron jobs everywhere: nightly database backups, weekly email
// digests, daily stock resets like this one.
//
// HOW VERCEL RUNS THIS:
// Vercel reads vercel.json for a "crons" config. It calls this URL
// at the specified schedule, just like a regular HTTP request.
// The function checks a secret token to make sure it's really Vercel calling.
//
// CRON SCHEDULE FORMAT: "0 15 * * *"
//   0   = minute 0
//   15  = hour 15 (UTC) = 9:00 AM Mexico City time
//   *   = every day of month
//   *   = every month
//   *   = every day of week
// Translation: "run at 15:00 UTC every day" = 9:00 AM CST

const KV_URL       = process.env.KV_REST_API_URL;
const KV_TOKEN     = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.admin_secret;

export default async function handler(req, res) {
    // Vercel passes CRON_SECRET as a bearer token to verify it's a legit cron call
    // We reuse ADMIN_SECRET here for simplicity
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (token !== ADMIN_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
        // Delegate to stock.js reset_all action
        const baseUrl = `https://${req.headers.host}`;
        const resetRes = await fetch(`${baseUrl}/api/stock`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${ADMIN_SECRET}`,
            },
            body: JSON.stringify({ action: 'reset_all' }),
        });

        const data = await resetRes.json();

        console.log(`[CRON] Daily stock reset complete. ${data.reset} products reset.`);
        return res.status(200).json({
            ok:      true,
            message: `Stock reset complete`,
            reset:   data.reset,
            time:    new Date().toISOString(),
        });

    } catch (err) {
        console.error('[CRON] Reset failed:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}
