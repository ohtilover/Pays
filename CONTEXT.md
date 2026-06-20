# El hada de los pays — Project Context

## What this is
A digital menu, ordering, and admin web app for a small artisanal bakery
called "El hada de los pays" in Celaya, Mexico. Built entirely in vanilla
HTML/CSS/JS with Tailwind (CDN), Vercel serverless functions, Upstash Redis,
Vercel Blob, and MercadoPago Checkout Pro.

Live site: https://pays-hazel.vercel.app
Admin panel: https://pays-hazel.vercel.app?admin=true
GitHub repo: https://github.com/ohtilover/Pays

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Frontend    | Vanilla HTML/CSS/JS + Tailwind CDN  |
| Backend     | Vercel Serverless Functions (Node)  |
| Database    | Upstash Redis (via Vercel KV)       |
| File storage| Vercel Blob                         |
| Payments    | MercadoPago Checkout Pro (Mexico)   |
| Hosting     | Vercel (Hobby plan)                 |
| Cron jobs   | Vercel Cron (vercel.json)           |

---

## File structure

```
Pays/
├── index.html              # Main app: menu + cart + admin panel (~2400 lines)
├── success.html            # Post-payment confirmation page
├── orden.html              # Customer order tracking page (polls every 15s)
├── vercel.json             # Cron: resets stock daily at 9AM Mexico City (15:00 UTC)
├── package.json            # Declares @vercel/blob dependency
├── CONTEXT.md              # This file
└── api/
    ├── auth.js             # POST → verifies password, returns role (admin/employee)
    ├── stock.js            # GET stock counts + limits / POST actions (set_limit, adjust, reset_all)
    ├── orders.js           # GET all paid orders / POST to update status
    ├── order-status.js     # GET single order status (PUBLIC — for customer tracking page)
    ├── sales.js            # GET/POST/DELETE in-person sales (POS)
    ├── analytics.js        # GET aggregated stats (merges orders + sales)
    ├── upload.js           # POST image upload → Vercel Blob → saves URL to KV
    ├── images.js           # GET all product image URLs (PUBLIC)
    ├── create-preference.js# POST → creates MercadoPago checkout preference
    ├── webhook.js          # POST → MercadoPago payment webhook (saves order, decrements stock)
    └── cron.js             # GET → daily stock reset (called by Vercel Cron)
```

---

## Environment variables (all set in Vercel)

```
KV_REST_API_URL             Upstash Redis endpoint
KV_REST_API_TOKEN           Upstash Redis auth token
KV_REST_API_READ_ONLY_TOKEN Upstash read-only token
BLOB_READ_WRITE_TOKEN       Vercel Blob storage token
MP_ACCESS_TOKEN             MercadoPago PRODUCTION access token (APP_USR-...)
MP_PUBLIC_KEY               MercadoPago PRODUCTION public key (APP_USR-530f94bc-...)
admin_secret                Admin password (lowercase key name — important)
EMPLOYEE_SECRET             Employee password
```

---

## KV key schema (Upstash Redis)

```
stock:current:{productId}   → number  (live units available right now)
stock:limit:{productId}     → number  (daily production limit, set by owner)
orders:{paymentId}          → JSON    (paid online order record)
sales:{timestamp}           → JSON    (in-person sale record)
images:{productId}          → string  (Vercel Blob public URL for product photo)
```

---

## Design system

| Token       | Value    | Usage                        |
|-------------|----------|------------------------------|
| inkDark     | #2A1A35  | Primary text, backgrounds    |
| lavender    | #9B6DC5  | Primary accent, buttons      |
| lavLight    | #B48FD4  | Secondary accent             |
| cream       | #FAF7FB  | Page background              |
| blush       | #E9A0B8  | Decorative accents           |

Fonts: Cormorant Garamond (headings/prices), Inter (body/UI)
Card style: glassmorphism with white background + subtle lavender border

---

## Product catalog (all hardcoded in index.html)

### data-id → name → price (MXN)

**Pays dulces:**
- test-peso → 🧪 Producto de prueba → $1 (test only, remove after payment testing)
- pay-strudel-manzana → Strudel de manzana → $130
- pay-queso → Pay de queso → $130
- pay-queso-fruta-choco → Pay de queso con fruta y/o chocolate → $140
- pay-guayaba → Pay de guayaba → $140
- pay-pina → Pay de piña → $140

**Pays salados:**
- pay-jamon-queso → Pay de jamón con queso → $130
- pay-atun → Pay de atún → $130
- pay-espinacas-queso → Pay de espinacas con queso → $130
- pay-champinones-queso → Pay de champiñones con queso → $130

**Panqué ($160 each):**
- panque-elote, panque-platano, panque-zanahoria, panque-naranja, panque-nuez, panque-marmoleado

**Galletas:**
- galletas-mantequilla → $160
- galletas-encaneladas → $160
- besos-nuez → $160
- galletas-avena → $130

**Otras delicias:**
- brownies → $130
- roles-canela → $35
- roles-canela-topping → $40
- bunuelos-aire → $140 (20 pz)
- tartaleta-frutas-individual → $45
- alfajores → $120 (6 pz)

**Pasteles:**
- cheesecake-tortuga → $400
- tartaleta-frutas-entera → $350
- pastel-tres-leches → $450
- pastel-red-velvet → $400
- imposible-elote → $450

---

## Admin panel (index.html — ?admin=true)

Authentication via /api/auth — returns role: 'admin' | 'employee'
Token stored in memory as `adminToken`, role as `adminRole`

### 4 tabs — visibility by role:

| Tab         | Admin | Employee |
|-------------|-------|----------|
| 📋 Pedidos  | ✅    | ✅       |
| 🏪 Venta    | ✅    | ✅       |
| 📊 Analytics| ✅    | ❌       |
| 📦 Stock    | ✅    | ❌       |

### Tab: Pedidos
- Loads from GET /api/orders
- Shows order cards with status buttons (pendiente / en preparación / listo)
- Status updates via POST /api/orders

### Tab: Venta (POS)
- Product grid — tap to register in-person sale
- Calls POST /api/sales (decrements stock, logs sale)
- Recent sales list with undo (DELETE /api/sales)
- Today's running total at top

### Tab: Analytics
- Loads from GET /api/analytics
- 4 stat cards: ingresos, transacciones, promedio, hoy
- Channel breakdown: online vs presencial (today)
- 7-day bar chart (today highlighted purple)
- Top 5 products horizontal bar chart
- Merges online orders + in-person sales

### Tab: Stock
- Per-product rows showing thumbnail, name, daily limit input, current stock stepper, status dot, camera upload
- Limit saved via POST /api/stock (action: set_limit)
- Stock adjusted via POST /api/stock (action: adjust, value: +1 or -1)
- Camera icon → file input → POST /api/upload → Vercel Blob → KV

---

## Customer-facing flow

1. Customer browses menu at pays-hazel.vercel.app
2. Adds items to cart (drawer UI, qty steppers)
3. Picks delivery date from calendar
4. Taps "Pagar pedido" → POST /api/create-preference → MercadoPago Checkout Pro
5. Pays on MercadoPago → redirected to success.html
6. success.html shows order summary + two buttons:
   - "Ver estado de mi pedido" → orden.html?id=PAYMENT_ID
   - "Confirmar por WhatsApp" → pre-filled WA message to 524613504042
7. orden.html polls /api/order-status?id=X every 15s for live status

---

## Automation

- Vercel Cron runs /api/cron daily at 15:00 UTC (9:00 AM Mexico City)
- Cron calls POST /api/stock with action: reset_all
- reset_all copies all stock:limit:{id} values → stock:current:{id}
- Result: every morning stock resets to daily production limits automatically

---

## Business info

- Business name: El hada de los pays
- Location: Lic. Andrés Quintana Roo 721-2, Las Fuentes, Celaya, Guanajuato
- WhatsApp: 524613504042
- Schedule: Mon-Tue/Fri-Sat 10AM-5PM, Wed 10AM-3PM, Thu 12PM-4PM, Sun closed

---

## Known pending tasks

- [ ] Remove test-peso product from menu once real payment is confirmed end-to-end
- [ ] Move product catalog from hardcoded HTML to KV (dynamic menu from admin)
- [ ] WhatsApp Business API auto-notification to owner on new payment
- [ ] Test full MercadoPago production flow with a different buyer account
- [ ] Consider Netlify migration to remove Vercel "Powered by" badge (Hobby plan limitation)

---

## Key patterns used throughout

**Auth:** Bearer token in Authorization header, checked in every POST endpoint.
Employee token accepted in: auth.js, stock.js (adjust only), sales.js, orders.js
Admin token required for: analytics.js, upload.js, stock set_limit/reset_all

**Stock:** Two-number model. `stock:limit` = daily production capacity (rarely changes).
`stock:current` = live count (decremented by webhook + venta tab, reset by cron).

**Event sourcing:** Every in-person sale logged as `sales:{timestamp}` record.
Analytics reads and aggregates both `orders:*` and `sales:*` keys.

**Image flow:** Upload binary → Vercel Blob → public URL → save to `images:{id}` in KV
→ /api/images returns all URLs → loadImages() applies to menu cards on page load.
