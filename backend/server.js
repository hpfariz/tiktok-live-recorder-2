const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// Route imports
const recorderRoutes = require('./routes/recorder');
const filesRoutes = require('./routes/files');
const uploadsRoutes = require('./routes/uploads');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, 'recordings');
fs.ensureDirSync(recordingsDir);

// API routes
app.use('/api/recorder', recorderRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/uploads', uploadsRoutes);

// Serve the main HTML file for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 TikTok Live Recorder Web running on port ${PORT}`);
  console.log(`📁 Recordings directory: ${recordingsDir}`);
});