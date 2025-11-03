const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_PATH = '/tiktok-recorder';

// Middleware
app.use(cors());
app.use(express.json());

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
fs.ensureDirSync(recordingsDir);

// Store monitoring processes for cleanup
let cleanupHandlers = [];

// Health check endpoint - MUST be at root level
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    recordings: fs.existsSync(recordingsDir),
    port: PORT,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    basePath: BASE_PATH
  });
});

// Keep-alive endpoint for preventing sleep
app.get('/keep-alive', (req, res) => {
  console.log(`Keep-alive ping received at ${new Date().toISOString()}`);
  res.json({ 
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Create a router for all TikTok recorder routes
const tiktokRouter = express.Router();

// API routes on the TikTok router
try {
  const recorderRoutes = require('./routes/recorder');
  const filesRoutes = require('./routes/files');
  const uploadsRoutes = require('./routes/uploads');
  
  tiktokRouter.use('/api/recorder', recorderRoutes);
  tiktokRouter.use('/api/files', filesRoutes);
  tiktokRouter.use('/api/uploads', uploadsRoutes);
  
  console.log('✅ API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error);
}

// API test endpoint
tiktokRouter.get('/api/test', (req, res) => {
  res.json({ 
    message: 'TikTok Recorder API is working', 
    routes: ['recorder', 'files', 'uploads'],
    basePath: BASE_PATH 
  });
});

// Serve static files for TikTok recorder
tiktokRouter.use(express.static(path.join(__dirname, 'public')));

// Catch-all for TikTok recorder SPA routing
tiktokRouter.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('TikTok Recorder index.html not found');
  }
});

// Mount the TikTok recorder router under BASE_PATH
app.use(BASE_PATH, tiktokRouter);

// Root redirect to homepage (when accessed on port 10000 directly)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Redirect</title>
      <meta http-equiv="refresh" content="0; url=${BASE_PATH}">
    </head>
    <body>
      <p>Redirecting to <a href="${BASE_PATH}">TikTok Recorder</a>...</p>
    </body>
    </html>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  
  // Return JSON for API routes, HTML for others
  if (req.path.includes('/api/')) {
    res.status(500).json({ 
      error: 'Internal server error', 
      message: err.message 
    });
  } else {
    res.status(500).send('Something went wrong!');
  }
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
  });
  
  // Clean up any Python processes
  try {
    const { spawn } = require('child_process');
    
    // Kill all Python processes started by this app
    const killProcess = spawn('pkill', ['-f', 'main.py']);
    killProcess.on('close', (code) => {
      console.log(`Python processes terminated with code ${code}`);
    });
    
    // Give processes time to clean up
    setTimeout(() => {
      console.log('Graceful shutdown complete');
      process.exit(0);
    }, 5000);
    
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  
  console.log(`Memory: Heap ${heapUsedMB}/${heapTotalMB} MB, RSS ${rssMB} MB`);
  
  // Warn if memory usage is high
  if (rssMB > 400) {
    console.warn('⚠️ High memory usage detected!');
    
    if (global.gc) {
      console.log('Running garbage collection...');
      global.gc();
    }
  }
}, 60000); // Check every minute

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TikTok Live Recorder running on port ${PORT}`);
  console.log(`📁 Recordings directory: ${recordingsDir}`);
  console.log(`🔗 Base path: ${BASE_PATH}`);
  console.log(`💾 Memory limit: ~512MB (Free tier)`);
  console.log(`🔄 Auto-recovery enabled`);
  console.log(`\n📍 Access the app at:`);
  console.log(`   - http://localhost:${PORT}${BASE_PATH}`);
  console.log(`   - http://152.69.214.36${BASE_PATH}`);
});