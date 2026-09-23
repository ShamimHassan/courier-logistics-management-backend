# 🎥 CourierFlow API — Demo Video Script

**Duration:** 5–10 minutes | **Language:** English or Bengali  
**Tool:** Postman (import `courierflow-api.postman_collection.json`)

---

## 1. Architecture Overview (60 sec)

Show the folder structure in VS Code:

```
Request → Express Router → authenticate (JWT) → authorize (role)
       → Route Handler → Service Layer → Prisma Transaction
       → Standardized { success, message, data } response
```

Key points to mention:
- 30 API endpoints, 3 roles, PostgreSQL + Prisma, SSLCommerz payments
- Redis caching, rate limiting, AuditLog on every critical write

---

## 2. Customer Flow (2 min)

### 2a. Register + Login
```
POST /auth/register  { name, email, phone, password }
→ 201 { user, accessToken, refreshToken, expiresIn: 900 }

POST /auth/login     { email, password }
→ 200 { user, accessToken, refreshToken }
```
Show: token auto-extracted by Postman collection script.

### 2b. Get a Quote
```
POST /shipments/quote
{ weightKg: 1.5, serviceType: "STANDARD", originZoneId, destinationZoneId }
→ 200 { quoteAmount: 189, breakdown: { base: 180, tax: 9 } }
```
Show: server calculates price — client can NEVER override.

### 2c. Create Shipment
```
POST /shipments   (with sender, recipient, parcel payload)
→ 201 { shipment: { trackingNumber: "CFY20260923...", status: "DRAFT" } }
```

### 2d. Initiate Payment
```
POST /payments/shipments/:id/checkout
→ 200 { gatewayUrl: "https://sandbox.sslcommerz.com/EasyCheckOut/..." }
```
Open `gatewayUrl` in browser — show the SSLCommerz hosted payment page.

### 2e. Get Tracking Timeline
```
GET /shipments/:id/tracking
→ 200 { events: [{ eventType: "DRAFT", humanReadableTime: "5 minutes ago" }] }
```

---

## 3. Admin Flow (2 min)

### 3a. Dashboard Stats
```
GET /admin/dashboard-stats
→ 200 { shipments: { total, inTransit, delivered }, revenue: { today, thisWeek } }
```

### 3b. Assign Courier to Shipment
```
POST /admin/shipments/:id/assign   { courierId }
→ 201 { assignmentStatus: "OFFERED", shipmentStatus: "ASSIGNED" }
```
Show: courier becomes unavailable, TrackingEvent written.

### 3c. Audit Logs
```
GET /admin/audit-logs?entityType=Shipment
→ 200 { logs: [{ action: "COURIER_ASSIGNED", actorId, oldValues, newValues }] }
```

### 3d. Issue Refund
```
POST /payments/:id/refund   { reason: "Customer requested cancellation" }
→ 200 { status: "REFUNDED", refundedAmount: 189 }
```

---

## 4. Courier Flow (2 min)

### 4a. Accept Assignment
```
PATCH /assignments/:id/accept
→ 200 { assignmentStatus: "ACCEPTED" }
```

### 4b. Pickup
```
POST /shipments/:id/pickup   { condition: "GOOD" }
→ 200 { status: "PICKED_UP" }
```

### 4c. Status Transitions (state machine)
```
PATCH /shipments/:id/status  { status: "AT_ORIGIN_HUB", hubId }  → 200
PATCH /shipments/:id/status  { status: "IN_TRANSIT" }             → 200
PATCH /shipments/:id/status  { status: "AT_DESTINATION_HUB", hubId } → 200
PATCH /shipments/:id/status  { status: "OUT_FOR_DELIVERY" }       → 200
```

### 4d. Successful Delivery
```
POST /shipments/:id/delivery-attempts
{ outcome: "DELIVERED", recipientName: "Nusrat Jahan", photoProofUrl: "..." }
→ 200 { outcome: "DELIVERED", courierEarnings: 108 }
```
Show: assignment COMPLETED, courier available=true, notification sent.

### 4e. Earnings Report
```
GET /couriers/me/earnings
→ 200 { summary: { totalEarnings, thisWeek, thisMonth, averagePerDelivery } }
```

---

## 5. Role Boundary Test (30 sec)

```
# Courier trying admin dashboard — should get 403
GET /admin/dashboard-stats   Authorization: Bearer {{courierToken}}
→ 403 { success: false, errors: [{ code: "FORBIDDEN" }] }

# Customer trying courier route — should get 403
GET /couriers/me   Authorization: Bearer {{customerToken}}
→ 403 Forbidden
```

---

## 6. Validation Error Demo (30 sec)

```
POST /auth/login   { email: "not-an-email", password: "x" }
→ 400 { success: false, message: "Validation failed",
         errors: [{ field: "email", code: "ZOD_INVALID_FORMAT" }] }
```

Also show:
```
POST /auth/register   { password: "weak" }
→ 400 with 4 password strength errors (uppercase, number, symbol, length)
```

---

## 7. SSLCommerz Payment Flow (60 sec)

1. `POST /payments/shipments/:id/checkout` → get `gatewayUrl`
2. Open URL — shows SSLCommerz sandbox payment page
3. Simulate IPN: `POST /payments/sslcommerz/ipn` (form-encoded)
4. Verify: `GET /payments/:id` → `status: "PAID"`
5. Verify: `GET /shipments/:id` → `status: "ASSIGNMENT_PENDING"`
6. Show idempotency: send same IPN again → `processed: false, reason: "Already processed"`

---

## 8. Technical Challenge Explanation (60 sec)

**Option A — Transaction-safe double-booking prevention (Step 19):**
> "When two admin requests try to assign different couriers to the same shipment simultaneously, the Prisma `$transaction` re-fetches and validates inside the lock. A unique constraint on `[shipmentId, courierId]` plus an active-assignment check ensures only one assignment succeeds. The second request gets a 409."

**Option B — SSLCommerz IPN idempotency (Step 26):**
> "SSLCommerz may deliver the same IPN multiple times. We prevent double-processing by storing `val_id` as a unique key in the `PaymentEvent` table. Before confirming any payment, we check if that `val_id` already exists. If it does, we return 200 OK without processing — SSLCommerz stops retrying."

---

## Quick Reference — Key Response Shapes

```json
// Success
{ "success": true, "message": "...", "data": {} }

// Error
{ "success": false, "message": "...", "errors": [{ "field": "email", "code": "...", "message": "..." }], "requestId": "uuid" }

// Paginated list
{ "success": true, "data": { "items": [], "meta": { "page": 1, "limit": 20, "totalCount": 45, "totalPages": 3 } } }
```
