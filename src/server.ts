import app from './app';
import { disconnectDatabase } from './config/database';
import { env } from './config/env';
import { reconcilePendingPayments } from './modules/payments/payments.service';

const server = app.listen(env.PORT, () => {
  console.log(`\n  🚚 CourierFlow Server is running`);
  console.log(`  📍 Environment : ${env.NODE_ENV}`);
  console.log(`  🌐 Local      : http://localhost:${env.PORT}`);
  console.log(`  🩺 Health     : http://localhost:${env.PORT}/api/v1/health\n`);

  // Run payment reconciliation on startup (catch stale PENDING payments)
  // and schedule it to run every hour
  const runReconciliation = () => {
    reconcilePendingPayments()
      .then(({ checked, confirmed, expired }) => {
        if (checked > 0) {
          console.log(`  💳 Payment reconciliation: checked=${checked} confirmed=${confirmed} expired=${expired}`);
        }
      })
      .catch((err) => console.error('Payment reconciliation error:', err));
  };

  runReconciliation();
  setInterval(runReconciliation, 60 * 60 * 1_000); // hourly
});

const shutdown = (signal: 'SIGTERM' | 'SIGINT'): void => {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await disconnectDatabase();
    console.log('Process terminated');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
