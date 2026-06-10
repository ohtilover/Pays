// api/images.js
// GET /api/images  → returns all saved product image URLs (public)
//
// This is a PUBLIC endpoint — no auth needed.
// The menu calls this on every page load to get the latest product photos.
// It reads from Upstash KV where the upload API saved the URLs.
//
// Key pattern in KV:
//   images:pay-queso    → https://abc.public.blob.vercel-storage.com/...
//   images:pay-guayaba  → https://abc.public.blob.vercel-storage.com/...

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
    res.setHeader('Cache-Control', 's-maxage=60'); // cache for 60s — images don't change often

    try {
        // Get all keys that start with 'images:'
        const keys = await kv('KEYS', 'images:*');

        if (!keys || !keys.length) {
            return res.status(200).json({ ok: true, images: {} });
        }

        // Fetch all URLs in parallel
        const urls = await Promise.all(keys.map(key => kv('GET', key)));

        // Build { productId: url } object
        // 'images:pay-queso' → strip 'images:' prefix to get 'pay-queso'
        const images = {};
        keys.forEach((key, i) => {
            const productId = key.replace('images:', '');
            if (urls[i]) images[productId] = urls[i];
        });

        return res.status(200).json({ ok: true, images });

    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
