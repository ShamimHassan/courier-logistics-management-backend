import { prisma } from '../../config/database';
import { AppError, NotFoundError } from '../../common/errors/AppError';

// ─── GET /notifications ───────────────────────────────────────────────────────

interface ListNotificationsQuery {
  page: number;
  limit: number;
  read?: boolean;
}

export const listNotifications = async (userId: string, query: ListNotificationsQuery) => {
  const { page, limit, read } = query;
  const skip = (page - 1) * limit;

  const where = {
    recipientId: userId,
    deletedAt: null,
    ...(read !== undefined ? { isRead: read } : {}),
  };

  const [totalCount, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        shipmentId: true,
        isRead: true,
        readAt: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { sentAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    notifications,
    meta: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
};

// ─── PATCH /notifications/:id/read ───────────────────────────────────────────

export const markNotificationRead = async (notificationId: string, userId: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { id: true, recipientId: true, isRead: true },
  });

  if (!notification) throw NotFoundError('Notification not found');

  if (notification.recipientId !== userId) {
    throw new AppError('You do not have access to this notification', 403, [
      { code: 'FORBIDDEN', message: 'You can only mark your own notifications as read' },
    ]);
  }

  if (notification.isRead) return notification; // already read — idempotent

  return prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
    select: {
      id: true, type: true, title: true, message: true,
      isRead: true, readAt: true, sentAt: true,
    },
  });
};
