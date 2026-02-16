/**
 * Main entry point for the Rate Limiter service
 */
import { setupSignalHandlers, shutdownServer, startServer } from './server';

// Setup graceful shutdown handlers
setupSignalHandlers();

// Start the server
// if (require.main === module) {
//   startServer();
// }

async function startApp(): Promise<void> {
  await startServer();
}

void startApp().catch();
// Export for testing
export { shutdownServer, startServer };
