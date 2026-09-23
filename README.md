# 🚚 CourierFlow — Courier & Logistics Management Platform

> **Full-stack backend API** for a Bangladesh-focused courier and logistics platform.
> Built with Node.js, TypeScript, Express, PostgreSQL (Prisma), and SSLCommerz.

---

## 🔗 Links

| Resource | URL |
|---|---|
| 📦 **Backend Repo** | https://github.com/ShamimHassan/courier-logistics-management-backend |
| 🌐 **Live API (Vercel)** | https://courier-logistics-management-backen.vercel.app/api/v1 |
| 📖 **API Docs (Postman)** | [`docs/postman/courierflow-api.postman_collection.json`](docs/postman/courierflow-api.postman_collection.json) |
| 📋 **Postman Environment** | [`docs/postman/courierflow.postman_environment.json`](docs/postman/courierflow.postman_environment.json) |
| 🎥 **Demo Video** | *(add Google Drive link)* |

---

## 👤 Demo Credentials

**Password for all demo accounts:** `CourierFlow@2026`

| Role | Email | Notes |
|---|---|---|
| 🔑 **Admin** | `admin@courierflow.com` | Full RBAC, dashboard, users, pricing rules, audit logs |
| 🚚 **Courier (APPROVED)** | `rafiq.courier@courierflow.com` | CourierProfile = APPROVED, Motorcycle, Dhaka zone |
| 🚚 **Courier (PENDING)** | `fatema.courier@courierflow.com` | CourierProfile = PENDING — can't accept assignments yet |
| 👤 **Customer 1** | `karim.customer@gmail.com` | Has default address + seeded shipments |
| 👤 **Customer 2** | `sultana.shop@gmail.com` | eCommerce shop use case |
| 👤 **Customer 3** | `tanzil.business@gmail.com` | B2B business use case |

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript 7 |
| Framework | Express 5 |
| ORM | Prisma 7 + PostgreSQL (with transactions & soft deletes) |
| Auth | JWT (access + rotating refresh tokens) + Google OAuth 2.0 |
| Payment | **SSLCommerz** (Bangladesh gateway — BDT, IPN validation, refund support) |
| Caching | Redis (ioredis) — graceful no-op if not configured |
| Validation | Zod v4 |
| Rate Limiting | express-rate-limit (global / auth / checkout tiers) |
| Security | Helmet, CORS allow-list, bcryptjs password hashing |
| Code Quality | Biome (linter + formatter) |
| Deployment | **Vercel** (serverless) + **Render** (IaaS alternative) |

---

## ✅ Submission Checklist

- [x] 3 fixed roles: CUSTOMER / COURIER / ADMIN with granular RBAC middleware
- [x] 30+ versioned REST APIs (`/api/v1`)
- [x] PostgreSQL + Prisma — schema, migrations, indexes, transactions, seed
- [x] Email/password auth + Google OAuth 2.0 with rotating refresh tokens
- [x] JWT Bearer + ownership checks on every user-courier scoped route
- [x] Zod validation on 100% of POST / PATCH routes (with structured errors)
- [x] Standardized `{ success, message, data }` envelope (+ `errors[]`, `requestId`)
- [x] Soft deletes (`deletedAt`) + **AuditLog** on every critical write
- [x] **SSLCommerz Checkout + IPN validation + idempotency + refund** (real BD gateway)
- [x] Redis caching (tracking 30s TTL, hubs/zones 5min TTL) — no-op when unavailable
- [x] Global rate limiting (100/min) + auth limiter (5/min) + checkout limiter (10/min)
- [x] Helmet + CORS allow-list + `trust proxy` (for Vercel / Render reverse proxies)
- [x] Shipment state machine (15+ statuses) + courier assignment atomic transaction
- [x] Delivery proof upload (Cloudinary) + 3-attempt return-to-hub logic
- [x] Courier earnings report + in-app notification system + delivery ratings
- [x] Admin hub CRUD + pricing rule versioning + dashboard stats
- [x] Pagination + filtering + sorting + full-text search on shipments
- [x] **Payment reconciliation** (auto-run on startup + every hour)
- [x] 30+ conventional commits

---

## 🚀 Quick Start — Local Development

```bash
# 1. Clone & install
git clone https://github.com/ShamimHassan/courier-logistics-management-backend.git
cd courier-logistics-management-backend
npm install

# 2. Set up environment variables
cp .env.example .env
# -> Edit .env and fill in DATABASE_URL, JWT secrets, etc.

# 3. Set up PostgreSQL & run migrations
npx prisma migrate deploy      # apply all migrations
npx prisma db seed             # seed users, hubs, zones, pricing rules, shipments

# 4. Start dev server (auto-reload via tsx)
npm run dev
```

Open:
- API root: http://localhost:5000/api/v1
- Health:   http://localhost:5000/api/v1/health

---

## 📡 API Reference

### Base URLs

| Environment | URL |
|---|---|
| Production (Vercel) | `https://courier-logistics-management-backen.vercel.app/api/v1` |
| Render (alternate) | `https://courierflow-api.onrender.com/api/v1` |
| Local (default) | `http://localhost:5000/api/v1` |

### Endpoint Groups

| Group | Base Path | Access | Description |
|---|---|---|---|
| 🔓 **Auth** | `/auth` | Public | Register, login, refresh, logout, Google OAuth |
| 👤 **Users** | `/users` | Authenticated | Self profile, update, change password |
| 🚚 **Couriers** | `/couriers` | COURIER role | Self profile, earnings, availability toggle |
| 📦 **Shipments** | `/shipments` | CUSTOMER / COURIER / ADMIN | Full CRUD + state machine, search, tracking |
| 💳 **Payments** | `/payments` | CUSTOMER / ADMIN | SSLCommerz checkout, IPN, refund, lookup |
| 🔔 **Notifications** | `/notifications` | Authenticated | List & mark read |
| 🏬 **Hubs** | `/hubs` | ADMIN (write) / ALL (read) | Hub list/detail/create/update |
| 📋 **Assignments** | `/assignments` | COURIER | Accept / reject assigned shipments |
| 🛡️ **Admin** | `/admin` | ADMIN role | Courier assign, pricing rules, users, audit logs, dashboard |

Quick test:

```bash
curl https://courier-logistics-management-backen.vercel.app/api/v1/health
# Expected: { "success": true, "message": "Service is healthy", "data": { ... } }
```

---

## ⚙️ Environment Variables

Copy `.env.example` → `.env` and fill in these values. For Vercel/Render, set via project dashboard (never commit secrets).

### ✅ Required for Production

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | `development` / `test` / `staging` / `production` |
| `PORT` | `5000` | Ignored on Vercel (serverless), used on Render/local |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | Pooled connection string |
| `DIRECT_URL` | *same as above* | Direct DB connection (for Prisma migrations) |
| `JWT_ACCESS_SECRET` | *(>= 32 chars, random)* | **Generate:** `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | *(>= 32 chars, random)* | Different from access secret |
| `APP_BASE_URL` | `https://courier-logistics-management-backen.vercel.app` | Public URL — used for SSLCommerz callbacks |
| `CORS_ORIGINS` | `https://your-frontend.vercel.app` | Comma-separated; include `localhost` for dev |

### 💳 SSLCommerz — Production (Mandatory for real payments)

| Variable | Value |
|---|---|
| `SSLCOMMERZ_STORE_ID` | Your registered store ID from SSLCommerz dashboard |
| `SSLCOMMERZ_STORE_PASSWORD` | Store password / API key |
| `SSLCOMMERZ_IS_SANDBOX` | `false` (production) or `true` (sandbox testing) |

> 💡 SSLCommerz IPN callback URLs auto-constructed as:
> - IPN: `{APP_BASE_URL}/api/v1/payments/sslcommerz/ipn`
> - Success: `{APP_BASE_URL}/api/v1/payments/sslcommerz/success`
> - Fail: `{APP_BASE_URL}/api/v1/payments/sslcommerz/fail`
> - Cancel: `{APP_BASE_URL}/api/v1/payments/sslcommerz/cancel`
>
> Register all 4 URLs in the SSLCommerz merchant dashboard → *IPN Settings*.

### 🔧 Optional Features

| Variable | Purpose |
|---|---|
| `ACCESS_TOKEN_TTL` | Default `15m` |
| `REFRESH_TOKEN_TTL` | Default `30d` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Google OAuth 2.0 |
| `REDIS_URL` | `redis://:password@host:port` — enables caching; gracefully skipped if empty |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Delivery proof photo uploads |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Kept for seed data backward-compat; not active in payments logic |

---

## 🏭 Production Deployment

### Option A: Vercel (Serverless) — ✅ Active Deployment

The project ships with [`vercel.json`](vercel.json) and [`api/index.ts`](api/index.ts) for zero-config serverless deploy.

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy + alias to production
vercel --prod

# 4. Set environment variables (via Vercel dashboard OR CLI):
vercel env add DATABASE_URL production
vercel env add JWT_ACCESS_SECRET production
vercel env add JWT_REFRESH_SECRET production
vercel env add NODE_ENV production
vercel env add APP_BASE_URL production
vercel env add CORS_ORIGINS production
# ... etc (see "Required for Production" table above)

# 5. Run migrations BEFORE first deploy or after schema changes:
# (Connect to the same DATABASE_URL locally then run:)
npx prisma migrate deploy
```

**Vercel deploy config** ([`vercel.json`](vercel.json)):
- All routes `/*` → single serverless handler at `api/index.ts`
- Handler normalizes Vercel's rewritten URLs, then delegates to Express
- Root `/` → 302 redirects to `/api/v1` (handled in [`src/app.ts`](src/app.ts#L45-L46))

**Vercel Prerequisites:**
1. A Neon / Supabase / Aiven PostgreSQL instance with public TCP access
2. In your Postgres provider dashboard: allow `0.0.0.0/0` OR add Vercel's NAT IPs (check docs for latest list)
3. Set `DIRECT_URL` and `DATABASE_URL` to the *same* pooled connection string in most cases

---

### Option B: Render (IaaS / Long-Running) — Alternative

Project ships with [`render.yaml`](render.yaml) for one-click Blueprint deploys.

Click **Deploy via Blueprint** in Render dashboard → upload [`render.yaml`](render.yaml), OR:

```bash
# 1. Blueprint auto-creates:
#    - PostgreSQL DB (courierflow-db, Singapore region)
#    - Redis instance (courierflow-cache)
#    - Node.js web service (courierflow-api)

# 2. Set remaining secrets in Render dashboard → Environment → Secret Files:
#    SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD, GOOGLE_CLIENT_ID, etc.

# 3. Build command (auto-run by render.yaml):
npm install && npx prisma generate && npx prisma migrate deploy && npm run build

# 4. Start command:
node dist/server.js
```

Render-specific notes:
- Health check path: `/api/v1/health` (auto-failover on 5xx)
- Payment reconciliation worker runs in-process (`setInterval` hourly) — on Render this is stable because the service stays alive

---

### 🗄️ Production Database — Every Deploy

**CRITICAL: Run migrations BEFORE the app boots (or immediately after deploy).**

```bash
# Always run this when Prisma schema changes:
npx prisma migrate deploy

# Optional: reseed demo data in a *new* empty DB:
npx prisma db seed

# Validate DB state:
npx prisma migrate status
```

Both Vercel & Render configs already include `prisma generate` + `migrate deploy` in their build commands, so **this happens automatically** on every deploy.

---

## 🔒 Production Security Checklist

Before flipping to real users, verify:

- [ ] `NODE_ENV=production` (disables verbose error stack traces in [`errorHandler.ts`](src/common/middleware/errorHandler.ts))
- [ ] `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET` are unique, 48+ char random values (never re-use dev secrets)
- [ ] `CORS_ORIGINS` lists only real frontend domains (remove `localhost:*` entirely for hardening)
- [ ] `SSLCOMMERZ_IS_SANDBOX=false` + real store credentials set
- [ ] SSLCommerz dashboard IPN URLs configured to your production `APP_BASE_URL`
- [ ] PostgreSQL firewall / IP allow-list includes hosting provider (Vercel / Render)
- [ ] Redis URL uses `rediss://` (TLS) in production when available
- [ ] Helmet active (already enabled in [`app.ts`](src/app.ts#L16)) — verify HTTP response headers
- [ ] `trust proxy = 1` (already set in [`app.ts`](src/app.ts#L14)) — correctly reads `X-Forwarded-For` for rate limiting
- [ ] No `.env` file committed; all secrets set via host dashboard

---

## 💳 SSLCommerz Payment Flow

```
  Customer clicks "Pay"
          │
          ▼
POST /api/v1/payments/shipments/:id/checkout
  └─ Creates Payment record (PENDING)
  └─ Calls SSLCommerz Init API → returns gatewayUrl
          │
          ▼
Frontend redirects to gatewayUrl
  └─ Customer enters bKash / Nagad / Rocket / Card info
  └─ SSLCommerz processes payment (BDT)
          │
          ├──► Server-to-server POST /payments/sslcommerz/ipn
  │          (IPN — always fires, main source of truth)
  │          1. Validates val_id via SSLCommerz validation API (anti-spoofing)
  │          2. Idempotent: if Payment already confirmed, no-op
  │          3. Payment → CONFIRMED
  │          4. Shipment → ASSIGNMENT_PENDING
  │          5. AuditLog, Notification, PaymentEvent created
  │
  ├──► User browser redirected: /payments/sslcommerz/success
  ├──► User browser redirected: /payments/sslcommerz/fail
  └──► User browser redirected: /payments/sslcommerz/cancel
                (confirmatory only — IPN already handled above)

# Refund (Admin)
POST /api/v1/admin/payments/:id/refund
  └─ Calls SSLCommerz Refund API
  └─ Payment → REFUNDED
```

**Sandbox Quick Start:**
Use SSLCommerz developer sandbox first: https://developer.sslcommerz.com — create a test store, use sandbox credentials, then switch `SSLCOMMERZ_IS_SANDBOX=true`.

---

## 🧑‍💻 Architecture

```
src/
├── app.ts              — Express app boot: Helmet, CORS, rate limiters, middleware,
│                          root "/" redirect, v1 mount, 404, global error handler
├── server.ts           — Node server entry: starts listen, reconciliation worker,
│                          graceful SIGTERM/SIGINT shutdown (DB disconnect)
├── config/             — env (Zod-validated), database (Prisma adapter),
│                          redis, sslcommerz (store config)
├── common/
│   ├── errors/         — AppError class + factory helpers
│   ├── middleware/     — authenticate, authorize(RBAC), rateLimiter (3 tiers),
│   │                      requestId (crypto.randomUUID), notFound, errorHandler
│   └── response/       — successResponse / errorResponse envelope factories
├── modules/
│   ├── auth/           — register, login, refresh, logout, Google OAuth
│   ├── users/          — profile, update, change password
│   ├── couriers/       — profile, availability toggle, earnings report
│   ├── shipments/      — quote, create, list/search (pag+filter+sort), detail,
│   │                     tracking (Redis cache), pickup, status machine,
│   │                     delivery attempts (3-strike rule), ratings, cancel
│   ├── payments/       — SSLCommerz checkout, IPN (+ val_id validation),
│   │                     success/fail/cancel, refund, lookup
│   ├── assignments/    — accept, reject (atomic transactions)
│   ├── admin/          — courier assign, pricing rule CRUD, user mgmt,
│   │                      audit logs, dashboard stats
│   ├── hubs/           — list, detail, create, update
│   ├── notifications/  — list, mark read
│   └── ratings/        — service for computing ratings
└── routes/v1.ts        — Router mount (all endpoints registered here)

Prisma:
prisma/schema.prisma   — 18 models, 8+ enums, indexes, onDelete: Restrict
prisma/migrations/     — Idempotent deploy: prisma migrate deploy
prisma/seed.ts         — Dev/prod seeding (upserts, idempotent)
```

---

## 🧪 Scripts

```bash
npm run dev                  # tsx watch (local hot-reload)
npm run build                # rimraf dist && tsc  (for Render/IaaS)
npm start                    # node dist/server.js (for Render/IaaS)

# Prisma
npm run prisma:generate      # Generate Prisma client
npm run prisma:migrate       # Create new migration (dev only)
npm run prisma:migrate:deploy  # Apply all pending migrations — PRODUCTION SAFE
npm run prisma:seed          # Run idempotent seed
npm run prisma:studio        # GUI DB browser on :5555
npm run prisma:push          # DANGER: schema push without migration (dev only)
npm run prisma:pull          # Introspect existing DB → schema.prisma

# Code quality
npm run lint                 # Biome lint check
npm run lint:fix             # Biome lint + format --write
npm run format               # Biome format check
npm run format:fix           # Biome format --write
```

---

## 💡 Troubleshooting Production

| Symptom | Likely Cause | Fix |
|---|---|---|
| `Route GET / not found` — Vercel | Vercel URL rewrites didn't normalize `req.url` | Fixed in [`api/index.ts`](api/index.ts#L15-L25) — redeploy to pick up |
| `CORS error` on frontend | Frontend domain not in CORS_ORIGINS | Update `CORS_ORIGINS` env var, redeploy |
| 500 on startup, Zod env errors | Missing required env vars | Set `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` in dashboard |
| Payment doesn't confirm after user pays | IPN blocked or `APP_BASE_URL` wrong | 1) `APP_BASE_URL` = exact public URL<br>2) IPN URLs registered in SSLCommerz dashboard<br>3) Open 443 inbound from SSLCommerz Sand |
| Prisma migration error on deploy | DIRECT_URL points to pooled proxy | Set `DIRECT_URL` to *direct* connection string (non-pooled) |
| Duplicate payment created | IPN retries without idempotency key | Handled — see [`payments.service.ts`](src/modules/payments/payments.service.ts) `val_id` uniqueness check |

---

## 📄 License

ISC © Md Shamim Hassan
