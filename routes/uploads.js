const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const router = express.Router();

// Store upload status
let uploadQueue = new Map(); // filename -> upload info
let uploadHistory = new Map(); // filename -> upload result

// Configure rclone with environment variables
function setupRclone() {
  const clientId = process.env.RCLONE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.RCLONE_DRIVE_CLIENT_SECRET;
  const token = process.env.RCLONE_DRIVE_TOKEN;

  if (!clientId || !clientSecret || !token) {
    console.error('Missing rclone environment variables');
    return false;
  }

  let actualToken;
  
  try {
    // First try to decode base64
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    console.log('Decoded token content:', decoded.substring(0, 100) + '...');
    
    // Check if it's a full rclone config or just a token
    if (decoded.includes('token = ')) {
      // Extract just the token part from the config
      const tokenMatch = decoded.match(/token = ({.*?})/s);
      if (tokenMatch) {
        actualToken = tokenMatch[1];
        console.log('Extracted token from config');
      } else {
        throw new Error('Could not extract token from config');
      }
    } else if (decoded.startsWith('{')) {
      // It's already a JSON token
      actualToken = decoded;
    } else {
      // Use original token
      actualToken = token;
    }
  } catch (error) {
    console.log('Token decode failed, using as-is:', error.message);
    actualToken = token;
  }

  // Create rclone config
  const configContent = `[drive]
type = drive
client_id = ${clientId}
client_secret = ${clientSecret}
scope = drive
token = ${actualToken}
team_drive = 
`;

  const configDir = path.join(process.env.HOME || '/tmp', '.config/rclone');
  const configPath = path.join(configDir, 'rclone.conf');
  
  try {
    fs.ensureDirSync(configDir);
    fs.writeFileSync(configPath, configContent);
    console.log('Rclone config created successfully');
    console.log('Config preview:', configContent.substring(0, 200) + '...');
    return true;
  } catch (error) {
    console.error('Failed to setup rclone config:', error);
    return false;
  }
}

// Initialize rclone on startup
setupRclone();

// Get upload queue and history
router.get('/', (req, res) => {
  const queue = Array.from(uploadQueue.entries()).map(([filename, info]) => ({
    filename,
    ...info
  }));

  const history = Array.from(uploadHistory.entries()).map(([filename, info]) => ({
    filename,
    ...info
  })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  res.json({
    queue,
    history: history.slice(0, 50) // Last 50 uploads
  });
});

// Upload file to Google Drive
router.post('/upload/:filename', async (req, res) => {
  const { filename } = req.params;
  const recordingsDir = path.join(__dirname, '../recordings');
  const filePath = path.join(recordingsDir, filename);

  // Check if file exists
  if (!await fs.pathExists(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Check if already uploading
  if (uploadQueue.has(filename)) {
    return res.status(400).json({ error: 'File is already being uploaded' });
  }

  // Only upload .mp4 files (not .flv files that are still being processed)
  if (!filename.endsWith('.mp4')) {
    return res.status(400).json({ error: 'Only MP4 files can be uploaded. Please wait for FLV to MP4 conversion to complete.' });
  }

  // Extract username from filename for folder structure
  const match = filename.match(/TK_([^_]+)_/);
  const username = match ? match[1] : 'unknown';
  
  const remotePath = `drive:root/pop4u/tiktok-live-recorder/${username}/${filename}`;

  // Add to upload queue
  uploadQueue.set(filename, {
    status: 'uploading',
    startTime: new Date(),
    progress: 0,
    remotePath,
    username
  });

  res.json({ 
    message: 'Upload started',
    filename,
    remotePath
  });

  // Start upload process
  startUpload(filename, filePath, remotePath);
});

// Upload all completed recordings
router.post('/upload-all', async (req, res) => {
  const recordingsDir = path.join(__dirname, '../recordings');
  
  try {
    const files = await fs.readdir(recordingsDir);
    
    // Only get MP4 files (not FLV files that are still being processed)
    const mp4Files = files.filter(file => 
      file.endsWith('.mp4') && 
      file.startsWith('TK_') &&
      !uploadQueue.has(file) && 
      !uploadHistory.has(file)
    );

    if (mp4Files.length === 0) {
      return res.json({ 
        message: 'No MP4 files available for upload. FLV files need to be converted first.',
        flvFiles: files.filter(f => f.endsWith('.flv')).length
      });
    }

    // Start uploads for all MP4 files
    const uploads = mp4Files.map(filename => {
      const filePath = path.join(recordingsDir, filename);
      const match = filename.match(/TK_([^_]+)_/);
      const username = match ? match[1] : 'unknown';
      const remotePath = `drive:root/pop4u/tiktok-live-recorder/${username}/${filename}`;

      uploadQueue.set(filename, {
        status: 'uploading',
        startTime: new Date(),
        progress: 0,
        remotePath,
        username
      });

      startUpload(filename, filePath, remotePath);
      
      return { filename, remotePath };
    });

    res.json({ 
      message: `Started uploading ${uploads.length} MP4 files`,
      uploads,
      skippedFlvFiles: files.filter(f => f.endsWith('.flv')).length
    });
  } catch (error) {
    console.error('Upload all error:', error);
    res.status(500).json({ error: 'Failed to start bulk upload' });
  }
});

// Cancel upload
router.delete('/cancel/:filename', (req, res) => {
  const { filename } = req.params;
  
  const uploadInfo = uploadQueue.get(filename);
  if (!uploadInfo) {
    return res.status(404).json({ error: 'Upload not found' });
  }

  if (uploadInfo.process && !uploadInfo.process.killed) {
    uploadInfo.process.kill('SIGTERM');
  }

  uploadQueue.delete(filename);
  
  res.json({ 
    message: 'Upload cancelled',
    filename 
  });
});

// Start upload function
function startUpload(filename, filePath, remotePath) {
  console.log(`Starting upload: ${filename} -> ${remotePath}`);

  const rcloneProcess = spawn('rclone', [
    'copy',
    filePath,
    path.dirname(remotePath),
    '--progress',
    '--stats', '1s'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const uploadInfo = uploadQueue.get(filename);
  if (uploadInfo) {
    uploadInfo.process = rcloneProcess;
  }

  // Handle progress output
  rcloneProcess.stderr.on('data', (data) => {
    const output = data.toString();
    console.log(`[Upload ${filename}] ${output}`);

    // Parse progress (rclone outputs progress to stderr)
    const progressMatch = output.match(/(\d+)%/);
    if (progressMatch && uploadInfo) {
      uploadInfo.progress = parseInt(progressMatch[1]);
    }
  });

  rcloneProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Upload ${filename}] ${output}`);
  });

  rcloneProcess.on('close', (code) => {
    console.log(`[Upload ${filename}] Process exited with code ${code}`);

    const uploadInfo = uploadQueue.get(filename);
    if (uploadInfo) {
      // Move to history
      uploadHistory.set(filename, {
        ...uploadInfo,
        status: code === 0 ? 'completed' : 'failed',
        completedAt: new Date(),
        exitCode: code
      });

      // Remove from queue
      uploadQueue.delete(filename);

      // If upload successful and auto-delete is enabled, delete local file
      if (code === 0) {
        console.log(`Upload completed successfully for ${filename}`);
        // Optionally delete local file after successful upload
        // fs.remove(filePath).catch(console.error);
      } else {
        console.error(`Upload failed for ${filename} with code ${code}`);
      }
    }
  });

  rcloneProcess.on('error', (error) => {
    console.error(`[Upload ${filename}] Process error:`, error);

    const uploadInfo = uploadQueue.get(filename);
    if (uploadInfo) {
      uploadHistory.set(filename, {
        ...uploadInfo,
        status: 'error',
        error: error.message,
        completedAt: new Date()
      });

      uploadQueue.delete(filename);
    }
  });
}

// Get upload status for specific file
router.get('/status/:filename', (req, res) => {
  const { filename } = req.params;
  
  const queueInfo = uploadQueue.get(filename);
  const historyInfo = uploadHistory.get(filename);
  
  if (queueInfo) {
    res.json({ ...queueInfo, inQueue: true });
  } else if (historyInfo) {
    res.json({ ...historyInfo, inQueue: false });
  } else {
    res.json({ status: 'not_uploaded', inQueue: false });
  }
});

// Clear upload history
router.delete('/history', (req, res) => {
  const count = uploadHistory.size;
  uploadHistory.clear();
  res.json({ 
    message: `Cleared ${count} items from upload history` 
  });
});

// Test rclone configuration
router.get('/test-config', (req, res) => {
  const rcloneProcess = spawn('rclone', ['lsd', 'drive:'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  let error = '';

  rcloneProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  rcloneProcess.stderr.on('data', (data) => {
    error += data.toString();
  });

  rcloneProcess.on('close', (code) => {
    if (code === 0) {
      res.json({ 
        success: true, 
        message: 'Rclone configuration is working',
        output 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Rclone configuration failed',
        error,
        code 
      });
    }
  });

  rcloneProcess.on('error', (err) => {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to run rclone',
      error: err.message 
    });
  });
});

module.exports = router;