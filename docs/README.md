# 📚 CourierFlow API Documentation

This folder contains all documentation artifacts for the CourierFlow project submission.

## Contents

| File | Description |
|---|---|
| `postman/courierflow-api.postman_collection.json` | Full Postman v2.1 collection — 7 folders, 40+ requests, auto-token extraction |
| `postman/courierflow.postman_environment.json` | Postman environment template with all required variables |
| `VIDEO_SCRIPT.md` | Structured 8-point video walkthrough script (5-10 min) |

## How to Use the Postman Collection

1. **Import Collection:** Open Postman → Import → select `courierflow-api.postman_collection.json`
2. **Import Environment:** Import → select `courierflow.postman_environment.json`
3. **Set `baseUrl`:** Update to your API URL (default: `http://localhost:5000/api/v1`)
4. **Run login requests** — tokens auto-populate via collection scripts:
   - `👤 Customer Auth & Profile` → `Login (Admin)` → sets `adminToken`
   - `👤 Customer Auth & Profile` → `Login (Courier)` → sets `courierToken`
   - `👤 Customer Auth & Profile` → `Login (Customer)` → sets `customerToken`
5. **Get zone IDs** — run `GET /hubs` and copy zone IDs from hub records into `dacZoneId` / `ctgZoneId`
6. **Get courier user ID** — run `GET /admin/users?search=Rafiq` and copy into `rafiqUserId`

## Postman Folder Structure

| # | Folder | Key Requests |
|---|---|---|
| 1 | 🏥 Health & Public | Health check, API index |
| 2 | 👤 Customer Auth & Profile | Register, Login (all roles), Refresh, Logout, Profile CRUD |
| 3 | 📦 Customer Shipment Lifecycle | Quote → Create → List → Detail → Track → Update → Cancel → Rate |
| 4 | 💳 SSLCommerz Payment Flow | Checkout → Simulate IPN → Verify status → Refund |
| 5 | 🔑 Admin Operations | Dashboard, User mgmt, Assign courier, Hub CRUD, Pricing rules, Audit logs |
| 6 | 🚚 Courier Operations | Accept/Reject, Pickup, 4 status scans, Deliver with proof, Earnings |
| 7 | ❌ Negative Tests | 401, 403, 400 Zod, 404, 409 double-assign, 409 duplicate rating |

## Video Recording Guide

See [VIDEO_SCRIPT.md](./VIDEO_SCRIPT.md) for the full structured walkthrough.

**TL;DR — 8 key points:**
1. Architecture overview
2. Customer: Register → Quote → Create → Pay (SSLCommerz) → Track
3. Admin: Dashboard → Assign Courier → Refund
4. Courier: Accept → Pickup → Status scans → Deliver with proof → Earnings
5. Role boundary: COURIER hits admin route → 403
6. Validation: invalid email → 400 structured Zod error
7. SSLCommerz: initiate → IPN → idempotency demo
8. Technical challenge: double-booking prevention OR IPN idempotency
