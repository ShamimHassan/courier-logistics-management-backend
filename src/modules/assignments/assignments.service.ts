import { AssignmentStatus, Role, ShipmentStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { AppError, ForbiddenError, NotFoundError } from '../../common/errors/AppError';
import type { RejectAssignmentInput } from './assignments.validation';

// ─── Shared: resolve courier profile from userId ──────────────────────────────

const resolveCourierProfile = async (userId: string) => {
  const profile = await prisma.courierProfile.findUnique({
    where: { userId },
    select: { id: true, userId: true },
  });
  if (!profile) throw ForbiddenError('No courier profile found for your account');
  return profile;
};

// ─── PATCH /assignments/:id/accept ────────────────────────────────────────────

export const acceptAssignment = async (
  assignmentId: string,
  userId: string,
  requestId?: string,
) => {
  const courierProfile = await resolveCourierProfile(userId);

  const assignment = await prisma.courierAssignment.findUnique({
    where: { id: assignmentId, deletedAt: null },
    select: {
      id: true,
      courierId: true,
      status: true,
      shipmentId: true,
      shipment: {
        select: {
          id: true,
          trackingNumber: true,
          customerId: true,
          status: true,
        },
      },
    },
  });

  if (!assignment) throw NotFoundError('Assignment not found');

  // Ownership: only the assigned courier can accept
  if (assignment.courierId !== courierProfile.id) {
    throw new AppError('This assignment does not belong to your account', 403, [
      { code: 'FORBIDDEN', message: 'You can only accept your own assignments' },
    ]);
  }

  if (assignment.status !== AssignmentStatus.OFFERED) {
    throw new AppError(
      `Assignment cannot be accepted in status "${assignment.status}"`,
      409,
      [{
        code: 'INVALID_ASSIGNMENT_STATUS',
        message: `Only OFFERED assignments can be accepted. Current: ${assignment.status}`,
      }],
    );
  }

  await prisma.$transaction(async (tx) => {
    // Update assignment → ACCEPTED
    await tx.courierAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    // Shipment stays ASSIGNED — no status change needed

    // TrackingEvent
    await tx.trackingEvent.create({
      data: {
        shipmentId: assignment.shipmentId,
        eventType: ShipmentStatus.ASSIGNED,
        notes: 'Courier accepted the assignment',
        actorId: userId,
        actorRole: Role.COURIER,
      },
    });

    // Notification to customer
    await tx.notification.create({
      data: {
        recipientId: assignment.shipment.customerId,
        type: 'ASSIGNMENT_ACCEPTED',
        title: 'Courier accepted your shipment',
        message: `A courier has accepted delivery of shipment ${assignment.shipment.trackingNumber} and will pick it up soon.`,
        shipmentId: assignment.shipmentId,
      },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: Role.COURIER,
        action: 'ASSIGNMENT_ACCEPTED',
        entityType: 'CourierAssignment',
        entityId: assignmentId,
        requestId: requestId ?? null,
        oldValues: { status: AssignmentStatus.OFFERED } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        newValues: { status: AssignmentStatus.ACCEPTED } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });
  });

  return {
    assignmentId,
    assignmentStatus: AssignmentStatus.ACCEPTED,
    shipmentId: assignment.shipmentId,
    trackingNumber: assignment.shipment.trackingNumber,
  };
};

// ─── PATCH /assignments/:id/reject ────────────────────────────────────────────

export const rejectAssignment = async (
  assignmentId: string,
  userId: string,
  payload: RejectAssignmentInput,
  requestId?: string,
) => {
  const courierProfile = await resolveCourierProfile(userId);

  const assignment = await prisma.courierAssignment.findUnique({
    where: { id: assignmentId, deletedAt: null },
    select: {
      id: true,
      courierId: true,
      status: true,
      shipmentId: true,
      shipment: {
        select: {
          id: true,
          trackingNumber: true,
          customerId: true,
        },
      },
    },
  });

  if (!assignment) throw NotFoundError('Assignment not found');

  if (assignment.courierId !== courierProfile.id) {
    throw new AppError('This assignment does not belong to your account', 403, [
      { code: 'FORBIDDEN', message: 'You can only reject your own assignments' },
    ]);
  }

  if (assignment.status !== AssignmentStatus.OFFERED) {
    throw new AppError(
      `Assignment cannot be rejected in status "${assignment.status}"`,
      409,
      [{
        code: 'INVALID_ASSIGNMENT_STATUS',
        message: `Only OFFERED assignments can be rejected. Current: ${assignment.status}`,
      }],
    );
  }

  // Find the admin user for the notification recipient
  const adminUser = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Update assignment → REJECTED with reason
    await tx.courierAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedReason: `${payload.reason}${payload.notes ? `: ${payload.notes}` : ''}`,
      },
    });

    // Free up the courier
    await tx.courierProfile.update({
      where: { id: courierProfile.id },
      data: { available: true },
    });

    // Shipment back to ASSIGNMENT_PENDING
    await tx.shipment.update({
      where: { id: assignment.shipmentId },
      data: { status: ShipmentStatus.ASSIGNMENT_PENDING },
    });

    // TrackingEvent
    await tx.trackingEvent.create({
      data: {
        shipmentId: assignment.shipmentId,
        eventType: ShipmentStatus.ASSIGNMENT_PENDING,
        notes: `Courier rejected assignment. Reason: ${payload.reason}${payload.notes ? ` — ${payload.notes}` : ''}`,
        actorId: userId,
        actorRole: Role.COURIER,
      },
    });

    // High-priority notification to admin
    if (adminUser) {
      await tx.notification.create({
        data: {
          recipientId: adminUser.id,
          type: 'ASSIGNMENT_REJECTED',
          title: 'Courier rejected assignment — needs reassignment',
          message: `Courier rejected shipment ${assignment.shipment.trackingNumber}. Reason: ${payload.reason}. Please reassign.`,
          shipmentId: assignment.shipmentId,
        },
      });
    }

    // AuditLog with reason
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: Role.COURIER,
        action: 'ASSIGNMENT_REJECTED',
        entityType: 'CourierAssignment',
        entityId: assignmentId,
        requestId: requestId ?? null,
        reason: payload.reason,
        oldValues: { status: AssignmentStatus.OFFERED } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        newValues: { status: AssignmentStatus.REJECTED, reason: payload.reason } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });
  });

  return {
    assignmentId,
    assignmentStatus: AssignmentStatus.REJECTED,
    shipmentId: assignment.shipmentId,
    shipmentStatus: ShipmentStatus.ASSIGNMENT_PENDING,
    trackingNumber: assignment.shipment.trackingNumber,
    reason: payload.reason,
  };
};
