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

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isAdmin(req) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    return token === ADMIN_SECRET;
}

const SEED = [
    { id:'pay-strudel-manzana',         name:'Strudel de manzana',                     price:130, category:'Pays dulces',    active:true },
    { id:'pay-queso',                    name:'Pay de queso',                           price:130, category:'Pays dulces',    active:true },
    { id:'pay-queso-fruta-choco',        name:'Pay de queso con fruta y/o chocolate',   price:140, category:'Pays dulces',    active:true },
    { id:'pay-guayaba',                  name:'Pay de guayaba',                         price:140, category:'Pays dulces',    active:true },
    { id:'pay-pina',                     name:'Pay de piña',                            price:140, category:'Pays dulces',    active:true },
    { id:'pay-jamon-queso',              name:'Pay de jamón con queso',                 price:130, category:'Pays salados',   active:true },
    { id:'pay-atun',                     name:'Pay de atún',                            price:130, category:'Pays salados',   active:true },
    { id:'pay-espinacas-queso',          name:'Pay de espinacas con queso',             price:130, category:'Pays salados',   active:true },
    { id:'pay-champinones-queso',        name:'Pay de champiñones con queso',           price:130, category:'Pays salados',   active:true },
    { id:'panque-elote',                 name:'Panqué de elote',                        price:160, category:'Panqué',         active:true },
    { id:'panque-platano',               name:'Panqué de plátano',                      price:160, category:'Panqué',         active:true },
    { id:'panque-zanahoria',             name:'Panqué de zanahoria',                    price:160, category:'Panqué',         active:true },
    { id:'panque-naranja',               name:'Panqué de naranja',                      price:160, category:'Panqué',         active:true },
    { id:'panque-nuez',                  name:'Panqué de nuez',                         price:160, category:'Panqué',         active:true },
    { id:'panque-marmoleado',            name:'Panqué marmoleado',                      price:160, category:'Panqué',         active:true },
    { id:'galletas-mantequilla',         name:'Galletas de mantequilla',                price:160, category:'Galletas',       active:true },
    { id:'galletas-encaneladas',         name:'Galletas encaneladas',                   price:160, category:'Galletas',       active:true },
    { id:'besos-nuez',                   name:'Besos de nuez',                          price:160, category:'Galletas',       active:true },
    { id:'galletas-avena',               name:'Galletas de avena',                      price:130, category:'Galletas',       active:true },
    { id:'brownies',                     name:'Brownies',                               price:130, category:'Otras delicias', active:true },
    { id:'roles-canela',                 name:'Roles de canela',                        price:35,  category:'Otras delicias', active:true },
    { id:'roles-canela-topping',         name:'Roles de canela con topping',            price:40,  category:'Otras delicias', active:true },
    { id:'bunuelos-aire',                name:'Buñuelos de aire (20 piezas)',           price:140, category:'Otras delicias', active:true },
    { id:'tartaleta-frutas-individual',  name:'Tartaleta con frutas (individual)',      price:45,  category:'Otras delicias', active:true },
    { id:'alfajores',                    name:'Alfajores (6 piezas)',                   price:120, category:'Otras delicias', active:true },
    { id:'cheesecake-tortuga',           name:'Cheesecake tortuga',                     price:400, category:'Pasteles',       active:true },
    { id:'tartaleta-frutas-entera',      name:'Tartaleta con frutas (entera)',          price:350, category:'Pasteles',       active:true },
    { id:'pastel-tres-leches',           name:'Pastel de tres leches',                 price:450, category:'Pasteles',       active:true },
    { id:'pastel-red-velvet',            name:'Pastel de red velvet',                  price:400, category:'Pasteles',       active:true },
    { id:'imposible-elote',              name:'Imposible de elote',                    price:450, category:'Pasteles',       active:true },
];

async function getCatalog() {
    const raw = await kv('GET', 'products:catalog');
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: public catalog ───────────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            let catalog = await getCatalog();
            if (!catalog) {
                catalog = SEED;
                await kv('SET', 'products:catalog', JSON.stringify(catalog));
            }
            return res.status(200).json({ ok: true, products: catalog });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // ── POST: admin mutations ─────────────────────────────────────────────
    if (req.method === 'POST') {
        if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

        const { action, product, id } = req.body;

        try {
            let catalog = (await getCatalog()) || [...SEED];

            if (action === 'upsert') {
                if (!product?.id || !product?.name || product?.price == null || !product?.category) {
                    return res.status(400).json({ ok: false, error: 'Missing required fields: id, name, price, category' });
                }
                const idx = catalog.findIndex(p => p.id === product.id);
                if (idx >= 0) {
                    catalog[idx] = { ...catalog[idx], ...product };
                } else {
                    catalog.push({ active: true, ...product });
                }

            } else if (action === 'delete') {
                if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
                catalog = catalog.filter(p => p.id !== id);

            } else if (action === 'toggle') {
                if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
                const p = catalog.find(p => p.id === id);
                if (p) p.active = p.active === false ? true : false;

            } else {
                return res.status(400).json({ ok: false, error: 'Unknown action' });
            }

            await kv('SET', 'products:catalog', JSON.stringify(catalog));
            return res.status(200).json({ ok: true, products: catalog });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
