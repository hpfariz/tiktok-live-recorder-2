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

// Health check endpoint FIRST
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    recordings: fs.existsSync(recordingsDir),
    port: PORT
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TikTok Live Recorder Web running on port ${PORT}`);
  console.log(`📁 Recordings directory: ${recordingsDir}`);
});