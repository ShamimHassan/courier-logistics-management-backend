import app from './app';

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, () => {
  console.log(`\n  🚚 CourierFlow Server is running`);
  console.log(`  📍 Environment : ${NODE_ENV}`);
  console.log(`  🌐 Local      : http://localhost:${PORT}`);
  console.log(`  🩺 Health     : http://localhost:${PORT}/api/v1/health\n`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

export default server;
