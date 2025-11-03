const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_PATH = '/split-bill';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure required directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// Initialize database
require('./database/db');

// Start cleanup scheduler
const { startCleanupSchedule } = require('./database/cleanup');
startCleanupSchedule();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    port: PORT,
    basePath: BASE_PATH
  });
});

// Create router for split-bill
const splitBillRouter = express.Router();

// API routes
try {
  const billsRoutes = require('./routes/bills');
  const settlementsRoutes = require('./routes/settlements');
  
  splitBillRouter.use('/api/bills', billsRoutes);
  splitBillRouter.use('/api/settlements', settlementsRoutes);
  
  // OCR routes (Google Cloud Vision)
  const ocrRoutes = require('./routes/ocr');
  splitBillRouter.use('/api/ocr', ocrRoutes);

  console.log('✅ API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error);
}

// Serve uploaded files
splitBillRouter.use('/uploads', express.static(uploadsDir));

// Serve static files
splitBillRouter.use(express.static(path.join(__dirname, 'public')));

// SPA routing - serve index.html for all non-API routes
splitBillRouter.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Split Bill app not found');
  }
});

// Mount the router
app.use(BASE_PATH, splitBillRouter);

// Root redirect
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Redirect</title>
      <meta http-equiv="refresh" content="0; url=${BASE_PATH}">
    </head>
    <body>
      <p>Redirecting to <a href="${BASE_PATH}">Split Bill</a>...</p>
    </body>
    </html>
  `);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  
  if (req.path.includes('/api/')) {
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
  console.log('\nSIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});

// OCR route (if Google Vision is configured)
try {
  const ocrRoutes = require('./routes/ocr');
  splitBillRouter.use('/api/ocr', ocrRoutes);
} catch (error) {
  console.log('OCR routes not available:', error.message);
}

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Split Bill app running on port ${PORT}`);
  console.log(`📁 Base path: ${BASE_PATH}`);
  console.log(`\n📍 Access the app at:`);
  console.log(`   - http://localhost:${PORT}${BASE_PATH}`);
  console.log(`   - http://152.69.214.36${BASE_PATH}`);
});