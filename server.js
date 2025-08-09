const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
fs.ensureDirSync(recordingsDir);

// API routes BEFORE static file serving
try {
  const recorderRoutes = require('./routes/recorder');
  const filesRoutes = require('./routes/files');
  const uploadsRoutes = require('./routes/uploads');
  
  app.use('/api/recorder', recorderRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/uploads', uploadsRoutes);
  
  console.log('✅ API routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error);
}

// Static file serving AFTER API routes
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    recordings: fs.existsSync(recordingsDir)
  });
});

// Catch-all for SPA (MUST be last)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 TikTok Live Recorder Web running on port ${PORT}`);
  console.log(`📁 Recordings directory: ${recordingsDir}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working', routes: ['recorder', 'files', 'uploads'] });
});