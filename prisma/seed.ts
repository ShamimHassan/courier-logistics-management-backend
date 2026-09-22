import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client/client';
import {
  AssignmentStatus,
  CourierApprovalStatus,
  PaymentStatus,
  Role,
  ServiceType,
  ShipmentStatus,
  UserStatus,
} from './generated/client/enums';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD = 'CourierFlow@2026';
const BCRYPT_COST = 12;

const hashPassword = async (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);

const main = async (): Promise<void> => {
  console.log('🌱 Starting to seed the development database...');
  const hashed = await hashPassword(DEMO_PASSWORD);
  console.log(`   🔐 Demo password hashed (cost=${BCRYPT_COST})`);

  // ── Idempotency cleanup: wipe seed-created create-only entities in FK-safe order ──
  console.log('🧹 Idempotency cleanup: wiping previous shipments/addresses/pricing/audit-children...');
  await prisma.customerProfile.updateMany({ data: { defaultAddressId: null } });
  await prisma.courierZone.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.trackingEvent.deleteMany();
  await prisma.courierAssignment.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.parcel.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.address.deleteMany();
  await prisma.pricingRule.deleteMany();
  console.log('   ✅ Cleanup complete, ready to re-seed.');

  // ───────────────────────────────────────────────────────────
  // 1. Zones (3)
  // ───────────────────────────────────────────────────────────
  console.log('📍 Creating 3 Zones...');
  const zoneDhaka = await prisma.zone.upsert({
    where: { code: 'ZONE-DAC-1206' },
    update: {},
    create: {
      code: 'ZONE-DAC-1206',
      name: 'Dhaka Central',
      region: 'Dhaka',
      city: 'Dhaka',
      baseRate: 80,
      isActive: true,
    },
  });
  const zoneCTG = await prisma.zone.upsert({
    where: { code: 'ZONE-CTG-4000' },
    update: {},
    create: {
      code: 'ZONE-CTG-4000',
      name: 'Chattogram Metro',
      region: 'Chattogram',
      city: 'Chattogram',
      baseRate: 180,
      isActive: true,
    },
  });
  const zoneSyl = await prisma.zone.upsert({
    where: { code: 'ZONE-SYL-3100' },
    update: {},
    create: {
      code: 'ZONE-SYL-3100',
      name: 'Sylhet Urban',
      region: 'Sylhet',
      city: 'Sylhet',
      baseRate: 240,
      isActive: true,
    },
  });
  console.log(`   ✅ Zones: ${zoneDhaka.name}, ${zoneCTG.name}, ${zoneSyl.name}`);

  // ───────────────────────────────────────────────────────────
  // 2. Hubs (Origin, Transit, Destination)
  // ───────────────────────────────────────────────────────────
  console.log('🏭 Creating 3 Hubs...');
  const hubOrigin = await prisma.hub.upsert({
    where: { code: 'HUB-DAC-ORIGIN' },
    update: {},
    create: {
      code: 'HUB-DAC-ORIGIN',
      name: 'Dhaka Origin Hub (Kamalapur)',
      address: 'Kamalapur, Motijheel, Dhaka',
      city: 'Dhaka',
      region: 'Dhaka',
      zip: '1206',
      originZoneId: zoneDhaka.id,
      operatingHours: 'Sat-Thu 08:00-20:00',
      contactPhone: '+880 2 9331234',
      isActive: true,
    },
  });
  const hubTransit = await prisma.hub.upsert({
    where: { code: 'HUB-CTG-TRANSIT' },
    update: {},
    create: {
      code: 'HUB-CTG-TRANSIT',
      name: 'Chattogram Transit Hub (New Market)',
      address: 'New Market, Chattogram',
      city: 'Chattogram',
      region: 'Chattogram',
      zip: '4000',
      originZoneId: zoneCTG.id,
      operatingHours: 'Sat-Thu 06:00-22:00',
      contactPhone: '+880 31 668765',
      isActive: true,
    },
  });
  const hubDest = await prisma.hub.upsert({
    where: { code: 'HUB-SYL-DEST' },
    update: {},
    create: {
      code: 'HUB-SYL-DEST',
      name: 'Sylhet Destination Hub (Zindabazar)',
      address: 'Zindabazar, Sylhet',
      city: 'Sylhet',
      region: 'Sylhet',
      zip: '3100',
      destinationZoneId: zoneSyl.id,
      operatingHours: 'Sat-Wed 08:00-21:00',
      contactPhone: '+880 821 712233',
      isActive: true,
    },
  });
  console.log(`   ✅ Hubs: ${hubOrigin.name}, ${hubTransit.name}, ${hubDest.name}`);

  // ───────────────────────────────────────────────────────────
  // 3. Users — Admin, 2 Couriers, 3 Customers
  // ───────────────────────────────────────────────────────────
  console.log('👥 Creating Users (1 Admin / 2 Couriers / 3 Customers)...');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@courierflow.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'admin@courierflow.com',
      passwordHash: hashed,
      name: 'Md. Admin Rahman',
      phone: '+880 1700 000001',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      lastLoginAt: new Date(),
    },
  });

  const courier1 = await prisma.user.upsert({
    where: { email: 'rafiq.courier@courierflow.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'rafiq.courier@courierflow.com',
      passwordHash: hashed,
      name: 'Rafiqul Islam',
      phone: '+880 1711 100200',
      role: Role.COURIER,
      status: UserStatus.ACTIVE,
      lastLoginAt: new Date(),
    },
  });

  const courier2 = await prisma.user.upsert({
    where: { email: 'fatema.courier@courierflow.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'fatema.courier@courierflow.com',
      passwordHash: hashed,
      name: 'Fatema Khatun',
      phone: '+880 1822 200300',
      role: Role.COURIER,
      status: UserStatus.ACTIVE,
    },
  });

  const cust1 = await prisma.user.upsert({
    where: { email: 'karim.customer@gmail.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'karim.customer@gmail.com',
      passwordHash: hashed,
      name: 'Karim Hossain',
      phone: '+880 1911 111222',
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      lastLoginAt: new Date(),
    },
  });
  const cust2 = await prisma.user.upsert({
    where: { email: 'sultana.shop@gmail.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'sultana.shop@gmail.com',
      passwordHash: hashed,
      name: 'Sultana Begum',
      phone: '+880 1722 333444',
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
  });
  const cust3 = await prisma.user.upsert({
    where: { email: 'tanzil.business@gmail.com' },
    update: { passwordHash: hashed },
    create: {
      email: 'tanzil.business@gmail.com',
      passwordHash: hashed,
      name: 'Tanzil Ahmed',
      phone: '+880 1633 444555',
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    },
  });
  console.log('   ✅ 6 users created/updated');

  // ───────────────────────────────────────────────────────────
  // 4. Courier Profiles (1 APPROVED + 1 PENDING) + CourierZones
  // ───────────────────────────────────────────────────────────
  console.log('🚚 Creating 2 Courier Profiles...');
  const profile1 = await prisma.courierProfile.upsert({
    where: { userId: courier1.id },
    update: {},
    create: {
      userId: courier1.id,
      approvalStatus: CourierApprovalStatus.APPROVED,
      vehicleType: 'MOTORCYCLE',
      vehiclePlateNumber: 'DHAKA-METRO-GA-12-3456',
      driverLicenseNumber: 'DL-DAC-98877665',
      available: true,
      averageRating: 4.85,
      totalRatings: 42,
      totalDeliveries: 318,
      totalEarnings: 167500,
      coverageRadiusKm: 20,
      notes: 'Top rated courier in Dhaka zone. Handles express deliveries.',
    },
  });
  const profile2 = await prisma.courierProfile.upsert({
    where: { userId: courier2.id },
    update: {},
    create: {
      userId: courier2.id,
      approvalStatus: CourierApprovalStatus.PENDING,
      vehicleType: 'VAN',
      vehiclePlateNumber: 'CTG-METRO-ChA-99-8877',
      driverLicenseNumber: 'DL-CTG-11223344',
      available: false,
      averageRating: 0,
      totalRatings: 0,
      totalDeliveries: 0,
      totalEarnings: 0,
      coverageRadiusKm: 25,
      notes: 'New applicant — awaiting background check & document verification.',
    },
  });
  await prisma.courierZone.deleteMany({ where: { courierId: profile1.id } });
  await prisma.courierZone.createMany({
    data: [
      { courierId: profile1.id, zoneId: zoneDhaka.id, isPrimary: true },
      { courierId: profile1.id, zoneId: zoneCTG.id, isPrimary: false },
    ],
  });
  await prisma.courierZone.deleteMany({ where: { courierId: profile2.id } });
  await prisma.courierZone.createMany({
    data: [{ courierId: profile2.id, zoneId: zoneCTG.id, isPrimary: true }],
  });
  console.log(`   ✅ Courier1 APPROVED (zones: Dhaka, CTG) | Courier2 PENDING (CTG)`);

  // ───────────────────────────────────────────────────────────
  // 5. Addresses (6 addresses for 3 customers sender/recipient)
  // ───────────────────────────────────────────────────────────
  console.log('🏠 Creating Addresses for customers...');
  const addr1Sender = await prisma.address.create({
    data: {
      label: 'Home - Office Sender',
      fullName: cust1.name,
      phone: cust1.phone ?? '+880 1900 000000',
      street: 'House 42, Road 11, Banani',
      city: zoneDhaka.city,
      region: zoneDhaka.region,
      zip: '1213',
      country: 'Bangladesh',
      zoneId: zoneDhaka.id,
      latitude: 23.794,
      longitude: 90.404,
    },
  });
  const addr1Recipient = await prisma.address.create({
    data: {
      label: "Friend's Place",
      fullName: 'Nusrat Jahan',
      phone: '+880 1511 666777',
      street: 'Flat 6B, Rahim Mansion, WASA Circle',
      city: zoneCTG.city,
      region: zoneCTG.region,
      zip: '4203',
      country: 'Bangladesh',
      zoneId: zoneCTG.id,
      latitude: 22.3693,
      longitude: 91.8079,
    },
  });
  const addr2Sender = await prisma.address.create({
    data: {
      label: 'Sultana Boutique Warehouse',
      fullName: cust2.name,
      phone: cust2.phone ?? '+880 1700 000002',
      street: 'Shop 102, Eastern Plaza, Hatirpool',
      city: zoneDhaka.city,
      region: zoneDhaka.region,
      zip: '1205',
      country: 'Bangladesh',
      zoneId: zoneDhaka.id,
      latitude: 23.753,
      longitude: 90.39,
    },
  });
  const addr2Recipient = await prisma.address.create({
    data: {
      label: 'Gift - Sister Sylhet',
      fullName: 'Sadia Rahman',
      phone: '+880 1755 888999',
      street: 'Holding 33/A, Ambarkhana',
      city: zoneSyl.city,
      region: zoneSyl.region,
      zip: '3102',
      country: 'Bangladesh',
      zoneId: zoneSyl.id,
      latitude: 24.9111,
      longitude: 91.8641,
    },
  });
  const addr3Sender = await prisma.address.create({
    data: {
      label: 'Tanzil Electronics',
      fullName: cust3.name,
      phone: cust3.phone ?? '+880 1600 000003',
      street: 'Shop 48, Multiplan Center, Elephant Road',
      city: zoneDhaka.city,
      region: zoneDhaka.region,
      zip: '1205',
      country: 'Bangladesh',
      zoneId: zoneDhaka.id,
      latitude: 23.7479,
      longitude: 90.385,
    },
  });
  const addr3Recipient = await prisma.address.create({
    data: {
      label: 'Home Delivery',
      fullName: 'Rashed Chowdhury',
      phone: '+880 1877 222333',
      street: 'House 8, Road 14, Sector 3, Uttara',
      city: zoneDhaka.city,
      region: zoneDhaka.region,
      zip: '1230',
      country: 'Bangladesh',
      zoneId: zoneDhaka.id,
      latitude: 23.8745,
      longitude: 90.3996,
    },
  });

  // ───────────────────────────────────────────────────────────
  // 6. CustomerProfiles with default addresses
  // ───────────────────────────────────────────────────────────
  console.log('🧾 Creating 3 CustomerProfiles with default addresses...');
  await prisma.customerProfile.upsert({
    where: { userId: cust1.id },
    update: { defaultAddressId: addr1Sender.id },
    create: {
      userId: cust1.id,
      defaultAddressId: addr1Sender.id,
      loyaltyPoints: 120,
      totalShipments: 8,
      notes: 'Regular express customer.',
    },
  });
  await prisma.customerProfile.upsert({
    where: { userId: cust2.id },
    update: { defaultAddressId: addr2Sender.id },
    create: {
      userId: cust2.id,
      defaultAddressId: addr2Sender.id,
      loyaltyPoints: 680,
      totalShipments: 45,
      notes: 'Boutique owner — sends multiple small parcels daily.',
    },
  });
  await prisma.customerProfile.upsert({
    where: { userId: cust3.id },
    update: { defaultAddressId: addr3Sender.id },
    create: {
      userId: cust3.id,
      defaultAddressId: addr3Sender.id,
      loyaltyPoints: 1530,
      totalShipments: 122,
      notes: 'Premium — electronics merchant. Requires insurance on every shipment.',
    },
  });
  console.log('   ✅ 3 CustomerProfiles linked with defaults');

  // ───────────────────────────────────────────────────────────
  // 7. 8+ PricingRules covering zone combos + services
  // ───────────────────────────────────────────────────────────
  console.log('💲 Creating 8+ PricingRules (weight/zone/service combos)...');
  const rules = [
    { origin: zoneDhaka, dest: zoneDhaka, svc: ServiceType.STANDARD, minKg: 0, maxKg: 2, price: 80, fee: 0, tax: 5, codFee: 2, codMin: 20 },
    { origin: zoneDhaka, dest: zoneDhaka, svc: ServiceType.EXPRESS, minKg: 0, maxKg: 2, price: 150, fee: 50, tax: 5, codFee: 2, codMin: 20 },
    { origin: zoneDhaka, dest: zoneCTG, svc: ServiceType.STANDARD, minKg: 0, maxKg: 3, price: 180, fee: 0, tax: 5, codFee: 3, codMin: 40 },
    { origin: zoneDhaka, dest: zoneCTG, svc: ServiceType.EXPRESS, minKg: 0, maxKg: 3, price: 280, fee: 80, tax: 5, codFee: 3, codMin: 40 },
    { origin: zoneDhaka, dest: zoneSyl, svc: ServiceType.STANDARD, minKg: 0, maxKg: 3, price: 240, fee: 0, tax: 5, codFee: 3, codMin: 50 },
    { origin: zoneDhaka, dest: zoneSyl, svc: ServiceType.EXPRESS, minKg: 0, maxKg: 3, price: 360, fee: 100, tax: 5, codFee: 3, codMin: 50 },
    { origin: zoneDhaka, dest: zoneDhaka, svc: ServiceType.STANDARD, minKg: 2, maxKg: 10, price: 120, fee: 15, tax: 5, codFee: 2, codMin: 20 },
    { origin: zoneDhaka, dest: zoneCTG, svc: ServiceType.STANDARD, minKg: 3, maxKg: 15, price: 280, fee: 30, tax: 5, codFee: 3, codMin: 40 },
    { origin: zoneCTG, dest: zoneSyl, svc: ServiceType.STANDARD, minKg: 0, maxKg: 5, price: 300, fee: 0, tax: 5, codFee: 3, codMin: 60, insurancePct: 2 },
  ];
  const createdRules: { id: string }[] = [];
  for (const r of rules) {
    const res = await prisma.pricingRule.create({
      data: {
        originZoneId: r.origin.id,
        destinationZoneId: r.dest.id,
        serviceType: r.svc,
        minWeightKg: r.minKg,
        maxWeightKg: r.maxKg,
        basePrice: r.price,
        weightSurchargePerKg: r.fee,
        expressFee: r.svc === ServiceType.EXPRESS ? (r.fee > 0 ? r.fee : 60) : 0,
        insuranceFeePercent: (r as { insurancePct?: number }).insurancePct ?? 1,
        taxRatePercent: r.tax,
        codFeePercent: r.codFee,
        codFeeMin: r.codMin,
        isActive: true,
      },
      select: { id: true },
    });
    createdRules.push(res);
  }
  console.log(`   ✅ ${createdRules.length} PricingRules stored`);

  // ───────────────────────────────────────────────────────────
  // 8. 3 sample Shipments with Parcel + Tracking + Payment + Assignment
  // ───────────────────────────────────────────────────────────
  console.log('📦 Creating 3 sample Shipments with Parcel/Tracking/Payment/Assignment...');
  const trackingNums = ['COF20260920DAC00001', 'COF20260920DAC00002', 'COF20260919SYL00003'];
  const now = Date.now();

  // Shipment 1 — IN_TRANSIT, COD + insured, Dhaka → CTG, STANDARD, PAID
  const ship1 = await prisma.shipment.create({
    data: {
      trackingNumber: trackingNums[0],
      customerId: cust1.id,
      senderAddressId: addr1Sender.id,
      recipientAddressId: addr1Recipient.id,
      originZoneId: zoneDhaka.id,
      destinationZoneId: zoneCTG.id,
      serviceType: ServiceType.STANDARD,
      status: ShipmentStatus.IN_TRANSIT,
      weightKg: 1.8,
      codAmount: 3500,
      insuranceAmount: 150,
      taxAmount: 22,
      baseAmount: 180,
      totalAmount: 457,
      currency: 'BDT',
      deliveryInstructions: 'Call before arrival. Leave with building security if absent.',
      specialNotes: 'COD amount of ৳3500 to collect. Original books — handle with care.',
      parcel: {
        create: {
          description: 'Hardcover book set — 2 copies of history textbook',
          weightKg: 1.8,
          lengthCm: 32,
          widthCm: 24,
          heightCm: 5,
          declaredValue: 15000,
          category: 'BOOKS',
          isFragile: false,
          insuranceEnabled: true,
        },
      },
      payment: {
        create: {
          customerId: cust1.id,
          amount: 457,
          status: PaymentStatus.PAID,
          provider: 'stripe',
          providerPaymentId: 'pi_test_shipment1_paid_0001',
          providerSessionId: 'cs_test_session_0001',
          paidAt: new Date(now - 6 * 3600 * 1000),
          receiptUrl: 'https://pay.stripe.com/receipts/ship1',
          events: {
            create: [
              {
                eventType: 'checkout.session.created',
                providerEventId: 'evt_test_create_0001',
                providerCreatedAt: new Date(now - 7 * 3600 * 1000),
                statusSnapshot: PaymentStatus.PENDING,
                rawPayload: { source: 'checkout', status: 'pending' },
              },
              {
                eventType: 'charge.succeeded',
                providerEventId: 'evt_test_paid_0001',
                providerCreatedAt: new Date(now - 6 * 3600 * 1000),
                statusSnapshot: PaymentStatus.PAID,
                rawPayload: { source: 'checkout', status: 'paid', paid: true },
              },
            ],
          },
        },
      },
      trackingEvents: {
        create: [
          { eventType: ShipmentStatus.DRAFT, location: 'Kamalapur Origin Hub, Dhaka', hubId: hubOrigin.id, notes: 'Shipment created online & label generated.', actorId: admin.id, actorRole: Role.ADMIN, createdAt: new Date(now - 12 * 3600 * 1000) },
          { eventType: ShipmentStatus.PICKED_UP, location: 'Banani, Dhaka', hubId: hubOrigin.id, notes: 'Parcel picked up from sender address.', actorId: courier1.id, actorRole: Role.COURIER, createdAt: new Date(now - 9 * 3600 * 1000) },
          { eventType: ShipmentStatus.AT_ORIGIN_HUB, location: 'Kamalapur, Dhaka', hubId: hubOrigin.id, notes: 'Package scanned at origin hub, manifest prepared.', actorId: admin.id, actorRole: Role.ADMIN, createdAt: new Date(now - 7 * 3600 * 1000) },
          { eventType: ShipmentStatus.IN_TRANSIT, location: 'Dhaka → Chattogram highway (N1)', hubId: hubTransit.id, notes: 'Departed Dhaka, en route to Chattogram transit hub.', actorId: courier1.id, actorRole: Role.COURIER, createdAt: new Date(now - 2 * 3600 * 1000) },
        ],
      },
    },
    include: { payment: true },
  });
  await prisma.courierAssignment.create({
    data: {
      shipmentId: ship1.id,
      courierId: profile1.id,
      status: AssignmentStatus.ACCEPTED,
      acceptedAt: new Date(now - 10 * 3600 * 1000),
      earnings: 240,
    },
  });

  // Shipment 2 — OUT_FOR_DELIVERY, express, insured, Dhaka→Sylhet, PAID (bKash)
  const ship2 = await prisma.shipment.create({
    data: {
      trackingNumber: trackingNums[1],
      customerId: cust3.id,
      senderAddressId: addr3Sender.id,
      recipientAddressId: addr2Recipient.id,
      originZoneId: zoneDhaka.id,
      destinationZoneId: zoneSyl.id,
      serviceType: ServiceType.EXPRESS,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
      weightKg: 0.75,
      codAmount: 0,
      insuranceAmount: 580,
      taxAmount: 47,
      baseAmount: 360,
      totalAmount: 987,
      currency: 'BDT',
      deliveryInstructions: 'Ring doorbell twice. Gift — do not mention price.',
      specialNotes: 'Insured electronics — fragile, keep upright.',
      parcel: {
        create: {
          description: 'Sony WH-1000XM5 Wireless Headphones (sealed retail)',
          weightKg: 0.75,
          lengthCm: 26,
          widthCm: 20,
          heightCm: 10,
          declaredValue: 58000,
          category: 'ELECTRONICS',
          isFragile: true,
          insuranceEnabled: true,
        },
      },
      payment: {
        create: {
          customerId: cust3.id,
          amount: 987,
          status: PaymentStatus.PAID,
          provider: 'bKash',
          providerPaymentId: '20260920987654321TRX01',
          providerSessionId: 'bkash_checkout_000998877',
          paidAt: new Date(now - 30 * 3600 * 1000),
          receiptUrl: 'https://receipts.bkash.example.com/998877',
          events: {
            create: [
              {
                eventType: 'payment.complete',
                providerEventId: 'evt_bkash_998877',
                providerCreatedAt: new Date(now - 30 * 3600 * 1000),
                statusSnapshot: PaymentStatus.PAID,
                rawPayload: { provider: 'bkash', trxId: '20260920987654321TRX01' },
              },
            ],
          },
        },
      },
      trackingEvents: {
        create: [
          { eventType: ShipmentStatus.DRAFT, location: 'Multiplan Center, Elephant Rd, Dhaka', hubId: hubOrigin.id, notes: 'Express order placed, insurance activated.', actorId: cust3.id, actorRole: Role.CUSTOMER, createdAt: new Date(now - 40 * 3600 * 1000) },
          { eventType: ShipmentStatus.PICKED_UP, location: 'Elephant Road', hubId: hubOrigin.id, notes: 'Courier picked up the sealed parcel.', actorId: courier1.id, actorRole: Role.COURIER, createdAt: new Date(now - 36 * 3600 * 1000) },
          { eventType: ShipmentStatus.AT_ORIGIN_HUB, location: 'Kamalapur', hubId: hubOrigin.id, notes: 'Insured express — stored in secure cage.', actorId: admin.id, actorRole: Role.ADMIN, createdAt: new Date(now - 30 * 3600 * 1000) },
          { eventType: ShipmentStatus.IN_TRANSIT, location: 'Air Cargo Road (Sylhet flight)', hubId: hubDest.id, notes: 'Boarded domestic cargo flight.', actorId: courier1.id, actorRole: Role.COURIER, createdAt: new Date(now - 18 * 3600 * 1000) },
          { eventType: ShipmentStatus.AT_DESTINATION_HUB, location: 'Zindabazar, Sylhet', hubId: hubDest.id, notes: 'Unloaded & scanned at Sylhet destination hub.', actorId: admin.id, actorRole: Role.ADMIN, createdAt: new Date(now - 3 * 3600 * 1000) },
          { eventType: ShipmentStatus.OUT_FOR_DELIVERY, location: 'Ambarkhana vicinity', hubId: hubDest.id, notes: 'Out for delivery — driver assigned.', actorId: courier1.id, actorRole: Role.COURIER, createdAt: new Date(now - 1 * 3600 * 1000) },
        ],
      },
    },
    include: { payment: true },
  });
  await prisma.courierAssignment.create({
    data: {
      shipmentId: ship2.id,
      courierId: profile1.id,
      status: AssignmentStatus.IN_PROGRESS,
      acceptedAt: new Date(now - 38 * 3600 * 1000),
      earnings: 520,
    },
  });

  // Shipment 3 — DRAFT (not yet paid/confirmed), COD Dhaka→Dhaka
  const ship3 = await prisma.shipment.create({
    data: {
      trackingNumber: trackingNums[2],
      customerId: cust2.id,
      senderAddressId: addr2Sender.id,
      recipientAddressId: addr3Recipient.id,
      originZoneId: zoneDhaka.id,
      destinationZoneId: zoneDhaka.id,
      serviceType: ServiceType.STANDARD,
      status: ShipmentStatus.DRAFT,
      weightKg: 0.9,
      codAmount: 1250,
      insuranceAmount: 0,
      taxAmount: 5,
      baseAmount: 80,
      totalAmount: 110,
      currency: 'BDT',
      deliveryInstructions: 'Fragile boutique — handle carefully, no folding.',
      specialNotes: 'COD order — collect ৳1250 at delivery.',
      parcel: {
        create: {
          description: 'Boutique package — 2 Sarees, wrapped and poly-sealed',
          weightKg: 0.9,
          lengthCm: 40,
          widthCm: 28,
          heightCm: 4,
          declaredValue: 1500,
          category: 'CLOTHING',
          isFragile: false,
          insuranceEnabled: false,
        },
      },
      payment: {
        create: {
          customerId: cust2.id,
          amount: 110,
          status: PaymentStatus.PENDING,
          provider: 'stripe',
          providerSessionId: 'cs_test_session_0003_pending',
        },
      },
      trackingEvents: {
        create: [
          { eventType: ShipmentStatus.DRAFT, location: 'Eastern Plaza, Hatirpool', hubId: hubOrigin.id, notes: 'COD order — awaiting pickup confirmation & payment.', actorId: cust2.id, actorRole: Role.CUSTOMER, createdAt: new Date(now - 20 * 60 * 1000) },
        ],
      },
    },
    include: { payment: true },
  });
  await prisma.courierAssignment.create({
    data: {
      shipmentId: ship3.id,
      courierId: profile1.id,
      status: AssignmentStatus.OFFERED,
      earnings: 70,
    },
  });
  console.log(`   ✅ 3 Shipments created: ${ship1.trackingNumber}, ${ship2.trackingNumber}, ${ship3.trackingNumber}`);

  console.log('\n🎉 Seeding completed successfully!');
  console.log(`   🔑 All demo users have the same password: ${DEMO_PASSWORD}`);
  console.log(`   👤 Admin     → ${admin.email}`);
  console.log(`   🚚 Courier 1 → ${courier1.email} (APPROVED, zones: Dhaka+CTG)`);
  console.log(`   🚚 Courier 2 → ${courier2.email} (PENDING, zone: CTG)`);
  console.log(`   🧑‍💼 Customers → ${cust1.email}, ${cust2.email}, ${cust3.email}`);
  console.log(`   📦 Shipments → 3 (IN_TRANSIT, OUT_FOR_DELIVERY, DRAFT/unpaid)`);
  console.log(`   💲 Pricing rules → 9 stored`);
  console.log(`   🏠 Addresses → 6 created, linked to 3 customers`);
  console.log(`   🔁 Running again is safe: users/zones/hubs use upsert on email/code unique fields.`);
};

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });