const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
fs.ensureDirSync(recordingsDir);

// Store monitoring processes for cleanup
let cleanupHandlers = [];

// Health check endpoint FIRST
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    recordings: fs.existsSync(recordingsDir),
    port: PORT,
    uptime: process.uptime(),
    memory: process.memoryUsage()
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

// API test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working', routes: ['recorder', 'files', 'uploads'] });
});

// API routes BEFORE static file serving (this is critical!)
try {
  const recorderRoutes = require('./routes/recorder');
  const filesRoutes = require('./routes/files');
  const uploadsRoutes = require('./routes/uploads');
  
  app.use('/api/recorder', recorderRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/uploads', uploadsRoutes);
  
} catch (error) {
  console.error('❌ Error loading routes:', error);
}

// Static file serving AFTER API routes
app.use(express.static('public'));

// Catch-all for SPA (MUST be last)
app.get('*', (req, res) => {
  // Only serve HTML for non-API routes
  if (!req.path.startsWith('/api/')) {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found');
    }
  } else {
    // For API routes that don't exist, return JSON error
    res.status(404).json({ 
      error: 'API endpoint not found',
      path: req.path,
      method: req.method
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  
  // Return JSON for API routes, HTML for others
  if (req.path.startsWith('/api/')) {
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
  // Don't exit on uncaught exceptions, try to keep running
  // But log it for debugging
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejections either
});

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  
  console.log(`Memory: Heap ${heapUsedMB}/${heapTotalMB} MB, RSS ${rssMB} MB`);
  
  // Warn if memory usage is high (Render free tier has 512MB limit)
  if (rssMB > 400) {
    console.warn('⚠️ High memory usage detected!');
    
    // Force garbage collection if available
    if (global.gc) {
      console.log('Running garbage collection...');
      global.gc();
    }
  }
}, 60000); // Check every minute

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TikTok Live Recorder Web running on port ${PORT}`);
  console.log(`📁 Recordings directory: ${recordingsDir}`);
  console.log(`💾 Memory limit: ~512MB (Render free tier)`);
  console.log(`🔄 Auto-recovery enabled for crashes`);
});