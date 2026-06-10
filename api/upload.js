// api/upload.js
// POST /api/upload
// Receives an image file, uploads it to Vercel Blob, saves the URL to KV
//
// HOW THIS WORKS:
// 1. Browser sends a FormData request with the image file and product ID
// 2. This function receives the raw binary data (the actual image bytes)
// 3. It forwards those bytes to Vercel Blob, which stores them and returns a URL
// 4. We save that URL to Upstash KV under the key 'images:{productId}'
// 5. The menu reads that URL on load and displays the real photo
//
// This is the same pattern used by every app that handles user photos:
// Instagram, WhatsApp, Airbnb — they all store images in blob/object storage
// and save the URL in their database.

import { put } from '@vercel/blob';

const KV_URL       = process.env.KV_REST_API_URL;
const KV_TOKEN     = process.env.KV_REST_API_TOKEN;
const ADMIN_SECRET = process.env.admin_secret;

async function kvSet(key, value) {
    const res = await fetch(KV_URL, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SET', key, value]),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

export const config = {
    api: {
        bodyParser: false, // IMPORTANT: disable body parsing so we can handle raw binary
    },
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-product-id');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

    // Auth check
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (token !== ADMIN_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // Product ID comes in as a header
    const productId = req.headers['x-product-id'];
    if (!productId) return res.status(400).json({ ok: false, error: 'Missing product ID' });

    try {
        // ── STEP 1: Read the raw request body (the image bytes) ───────────
        // Since we disabled bodyParser above, we read the raw stream manually.
        // This is necessary for binary data — JSON parsers would corrupt image bytes.
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const buffer      = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || 'image/jpeg';

        // ── STEP 2: Upload to Vercel Blob ─────────────────────────────────
        // 'put' stores the file and returns a public URL.
        // The filename includes the product ID so we can identify it later.
        // 'access: public' means anyone can view it — correct for product photos.
        const filename = `products/${productId}-${Date.now()}.jpg`;
        const blob = await put(filename, buffer, {
            access:      'public',
            contentType: contentType,
        });

        // blob.url looks like:
        // https://abc123.public.blob.vercel-storage.com/products/pay-queso-1234567890.jpg

        // ── STEP 3: Save the URL to Upstash KV ───────────────────────────
        // Key: 'images:pay-queso'  Value: 'https://...'
        // The menu reads this on load to display the right photo per product.
        await kvSet(`images:${productId}`, blob.url);

        return res.status(200).json({ ok: true, url: blob.url });

    } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}
