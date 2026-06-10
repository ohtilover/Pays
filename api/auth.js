// api/auth.js
// POST /api/auth  → verifies password, returns role
//
// WHY A SEPARATE AUTH ENDPOINT?
// The login screen needs to know the role BEFORE showing the admin panel.
// This endpoint takes a password and returns { role: 'admin' | 'employee' }
// The frontend stores the role in memory and uses it to show/hide tabs.
//
// This is a simplified version of how real auth works:
// In production apps, this would return a signed JWT token instead of
// just a role string. But for our use case, storing the role in memory
// after a successful login is clean and sufficient.

const ADMIN_SECRET    = process.env.admin_secret;
const EMPLOYEE_SECRET = process.env.EMPLOYEE_SECRET;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).end();

    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

    if (token === ADMIN_SECRET)    return res.status(200).json({ ok: true, role: 'admin' });
    if (token === EMPLOYEE_SECRET) return res.status(200).json({ ok: true, role: 'employee' });

    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
}
