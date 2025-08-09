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
  console.log('🔧 Setting up rclone configuration...');
  
  const clientId = process.env.RCLONE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.RCLONE_DRIVE_CLIENT_SECRET;
  const token = process.env.RCLONE_DRIVE_TOKEN;

  console.log('Environment variables check:');
  console.log('- CLIENT_ID:', clientId ? 'Present' : 'Missing');
  console.log('- CLIENT_SECRET:', clientSecret ? 'Present' : 'Missing');
  console.log('- TOKEN:', token ? 'Present' : 'Missing');

  if (!clientId || !clientSecret || !token) {
    console.error('❌ Missing rclone environment variables');
    return false;
  }

  let actualToken;
  
  try {
    // Remove surrounding quotes if present
    let cleanToken = token.trim();
    if (cleanToken.startsWith("'") && cleanToken.endsWith("'")) {
      cleanToken = cleanToken.slice(1, -1);
    }
    if (cleanToken.startsWith('"') && cleanToken.endsWith('"')) {
      cleanToken = cleanToken.slice(1, -1);
    }
    
    console.log('Cleaned token preview:', cleanToken.substring(0, 50) + '...');
    
    // Check if it's already JSON
    if (cleanToken.startsWith('{') && cleanToken.endsWith('}')) {
      // Validate JSON
      const parsed = JSON.parse(cleanToken);
      console.log('✅ Token is valid JSON');
      console.log('Token expires:', parsed.expiry);
      
      // Check if token is expired
      const expiryDate = new Date(parsed.expiry);
      const now = new Date();
      if (expiryDate < now) {
        console.warn('⚠️ WARNING: Token appears to be expired!');
        console.warn('Expiry:', expiryDate.toISOString());
        console.warn('Now:   ', now.toISOString());
      }
      
      actualToken = cleanToken;
    } else {
      throw new Error('Token does not appear to be valid JSON format');
    }
    
  } catch (error) {
    console.error('❌ Token parsing failed:', error.message);
    console.error('Raw token preview:', token.substring(0, 100));
    return false;
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
    console.log('📁 Creating config directory:', configDir);
    fs.ensureDirSync(configDir);
    
    console.log('📝 Writing config file:', configPath);
    fs.writeFileSync(configPath, configContent);
    
    // Verify file was created
    if (fs.existsSync(configPath)) {
      const stats = fs.statSync(configPath);
      console.log('✅ Config file created successfully');
      console.log('File size:', stats.size, 'bytes');
      console.log('File permissions:', stats.mode.toString(8));
      
      // Show first few lines of config for verification
      const configPreview = configContent.split('\n').slice(0, 6).join('\n');
      console.log('Config preview:');
      console.log(configPreview);
      
      return true;
    } else {
      console.error('❌ Config file was not created');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Failed to setup rclone config:', error);
    console.error('Error details:', error.stack);
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

// Auto-upload files for a specific user (called by recorder after 5 minutes)
router.post('/auto-upload/:username', async (req, res) => {
  const { username } = req.params;
  const recordingsDir = path.join(__dirname, '../recordings');
  
  try {
    console.log(`🔍 Checking for files to auto-upload for @${username}`);
    
    const files = await fs.readdir(recordingsDir);
    console.log(`📁 Found ${files.length} total files in recordings directory`);
    
    // Find MP4 files for this user that haven't been uploaded yet
    // Look for both .mp4 files (converted) and exclude _flv.mp4 files (being recorded)
    const userMp4Files = files.filter(file => {
      const isForUser = file.includes(`TK_${username}_`);
      const isMp4 = file.endsWith('.mp4');
      const isNotFlv = !file.includes('_flv.mp4'); // Exclude files currently being recorded
      const notInQueue = !uploadQueue.has(file);
      const notInHistory = !uploadHistory.has(file);
      
      console.log(`📄 Checking file: ${file}`);
      console.log(`  - For user: ${isForUser}`);
      console.log(`  - Is MP4: ${isMp4}`);
      console.log(`  - Not FLV: ${isNotFlv}`);
      console.log(`  - Not in queue: ${notInQueue}`);
      console.log(`  - Not in history: ${notInHistory}`);
      
      return isForUser && isMp4 && isNotFlv && notInQueue && notInHistory;
    });

    console.log(`✅ Found ${userMp4Files.length} files eligible for auto-upload: ${userMp4Files.join(', ')}`);

    if (userMp4Files.length === 0) {
      return res.json({ 
        message: `No new MP4 files found for @${username} to auto-upload`,
        username,
        filesFound: 0,
        totalFiles: files.length,
        allFiles: files.filter(f => f.includes(`TK_${username}_`))
      });
    }

    // Start uploads for all new MP4 files for this user
    const uploads = userMp4Files.map(filename => {
      const filePath = path.join(recordingsDir, filename);
      const remotePath = `drive:pop4u/tiktok-live-recorder/${username}/${filename}`;

      uploadQueue.set(filename, {
        status: 'uploading',
        startTime: new Date(),
        progress: 0,
        remotePath,
        username,
        isAutoUpload: true // Flag to identify auto-uploads
      });

      console.log(`🚀 Starting auto-upload: ${filename} -> ${remotePath}`);
      startUpload(filename, filePath, remotePath);
      
      return { filename, remotePath };
    });

    console.log(`🤖 Auto-upload started for @${username}: ${uploads.length} files`);

    res.json({ 
      message: `Auto-upload started for @${username}: ${uploads.length} files`,
      username,
      filesFound: uploads.length,
      uploads
    });
  } catch (error) {
    console.error(`Auto-upload error for @${username}:`, error);
    res.status(500).json({ error: `Failed to start auto-upload for @${username}: ${error.message}` });
  }
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

  // Don't allow upload of _flv.mp4 files (currently being recorded)
  if (filename.includes('_flv.mp4')) {
    return res.status(400).json({ error: 'Cannot upload file that is currently being recorded. Please wait for recording to finish and convert to MP4.' });
  }

  // Extract username from filename for folder structure
  const match = filename.match(/TK_([^_]+)_/);
  const username = match ? match[1] : 'unknown';
  
  const remotePath = `drive:pop4u/tiktok-live-recorder/${username}/${filename}`;

  // Add to upload queue
  uploadQueue.set(filename, {
    status: 'uploading',
    startTime: new Date(),
    progress: 0,
    remotePath,
    username,
    isAutoUpload: false // Manual upload
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
    // Also exclude _flv.mp4 files that are currently being recorded
    const mp4Files = files.filter(file => 
      file.endsWith('.mp4') && 
      file.startsWith('TK_') &&
      !file.includes('_flv.mp4') && // Exclude files currently being recorded
      !uploadQueue.has(file) && 
      !uploadHistory.has(file)
    );

    if (mp4Files.length === 0) {
      const flvFiles = files.filter(f => f.endsWith('.flv') || f.includes('_flv.mp4'));
      return res.json({ 
        message: 'No completed MP4 files available for upload. FLV files need to be converted first.',
        flvFiles: flvFiles.length
      });
    }

    // Start uploads for all MP4 files
    const uploads = mp4Files.map(filename => {
      const filePath = path.join(recordingsDir, filename);
      const match = filename.match(/TK_([^_]+)_/);
      const username = match ? match[1] : 'unknown';
      const remotePath = `drive:pop4u/tiktok-live-recorder/${username}/${filename}`;

      uploadQueue.set(filename, {
        status: 'uploading',
        startTime: new Date(),
        progress: 0,
        remotePath,
        username,
        isAutoUpload: false // Manual bulk upload
      });

      startUpload(filename, filePath, remotePath);
      
      return { filename, remotePath };
    });

    res.json({ 
      message: `Started uploading ${uploads.length} MP4 files`,
      uploads,
      skippedFlvFiles: files.filter(f => f.endsWith('.flv') || f.includes('_flv.mp4')).length
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
  console.log(`🚀 Starting upload: ${filename} -> ${remotePath}`);

  // Verify file exists and get size
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    const uploadInfo = uploadQueue.get(filename);
    if (uploadInfo) {
      uploadHistory.set(filename, {
        ...uploadInfo,
        status: 'failed',
        error: 'File not found',
        completedAt: new Date()
      });
      uploadQueue.delete(filename);
    }
    return;
  }

  const fileStats = fs.statSync(filePath);
  console.log(`📊 File size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

  const rcloneProcess = spawn('rclone', [
    'copy',
    filePath,
    path.dirname(remotePath),
    '--progress',
    '--stats', '1s',
    '--transfers', '1',
    '--checkers', '1'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const uploadInfo = uploadQueue.get(filename);
  if (uploadInfo) {
    uploadInfo.process = rcloneProcess;
    uploadInfo.fileSize = fileStats.size;
  }

  // Handle progress output
  rcloneProcess.stderr.on('data', (data) => {
    const output = data.toString();
    
    // Log all rclone output for debugging
    console.log(`[Upload ${filename}] ${output.trim()}`);

    // Parse progress (rclone outputs progress to stderr)
    const progressMatch = output.match(/(\d+)%/);
    if (progressMatch && uploadInfo) {
      const newProgress = parseInt(progressMatch[1]);
      if (newProgress !== uploadInfo.progress) {
        uploadInfo.progress = newProgress;
        console.log(`📈 Upload progress for ${filename}: ${newProgress}%`);
      }
    }

    // Look for transfer rate info
    const transferMatch = output.match(/(\d+\.\d+\s*[kMG]?Bytes\/s)/);
    if (transferMatch && uploadInfo) {
      uploadInfo.transferRate = transferMatch[1];
    }
  });

  rcloneProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Upload ${filename}] STDOUT: ${output.trim()}`);
  });

  rcloneProcess.on('close', (code) => {
    console.log(`[Upload ${filename}] Process exited with code ${code}`);

    const uploadInfo = uploadQueue.get(filename);
    if (uploadInfo) {
      const uploadType = uploadInfo.isAutoUpload ? 'Auto-upload' : 'Manual upload';
      
      // Move to history
      uploadHistory.set(filename, {
        ...uploadInfo,
        status: code === 0 ? 'completed' : 'failed',
        completedAt: new Date(),
        exitCode: code,
        progress: code === 0 ? 100 : uploadInfo.progress || 0
      });

      // Remove from queue
      uploadQueue.delete(filename);

      if (code === 0) {
        console.log(`✅ ${uploadType} completed successfully for ${filename}`);
        // Optionally delete local file after successful upload
        // fs.remove(filePath).catch(console.error);
      } else {
        console.error(`❌ ${uploadType} failed for ${filename} with code ${code}`);
      }
    }
  });

  rcloneProcess.on('error', (error) => {
    console.error(`[Upload ${filename}] Process error:`, error);

    const uploadInfo = uploadQueue.get(filename);
    if (uploadInfo) {
      uploadHistory.set(filename, {
        ...uploadInfo,
        status: 'failed',
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
  console.log('🧪 Testing rclone configuration...');
  
  // First try to setup config
  const setupResult = setupRclone();
  console.log('Setup result:', setupResult);
  
  if (!setupResult) {
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to setup rclone config',
      error: 'Check server logs for details'
    });
  }

  // Test rclone command
  const rcloneProcess = spawn('rclone', ['lsd', 'drive:'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';
  let error = '';

  rcloneProcess.stdout.on('data', (data) => {
    const text = data.toString();
    output += text;
    console.log('rclone stdout:', text);
  });

  rcloneProcess.stderr.on('data', (data) => {
    const text = data.toString();
    error += text;
    console.log('rclone stderr:', text);
  });

  rcloneProcess.on('close', (code) => {
    console.log('rclone process exited with code:', code);
    
    if (code === 0) {
      res.json({ 
        success: true, 
        message: 'Rclone configuration is working',
        output: output || 'No directories found (empty drive)' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Rclone configuration failed',
        error: error || 'Unknown error',
        code,
        setupResult 
      });
    }
  });

  rcloneProcess.on('error', (err) => {
    console.error('rclone process error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to run rclone command',
      error: err.message,
      setupResult 
    });
  });
});

// Force recreate config endpoint for debugging
router.post('/recreate-config', (req, res) => {
  console.log('🔄 Force recreating rclone config...');
  
  const result = setupRclone();
  
  res.json({
    success: result,
    message: result ? 'Config recreated successfully' : 'Failed to recreate config',
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to list files and their status
router.get('/debug/files/:username', async (req, res) => {
  const { username } = req.params;
  const recordingsDir = path.join(__dirname, '../recordings');
  
  try {
    const files = await fs.readdir(recordingsDir);
    const userFiles = files.filter(f => f.includes(`TK_${username}_`));
    
    const fileDetails = await Promise.all(userFiles.map(async (filename) => {
      const filePath = path.join(recordingsDir, filename);
      const stats = await fs.stat(filePath);
      
      return {
        filename,
        size: stats.size,
        sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
        modified: stats.mtime,
        isFlv: filename.includes('_flv.mp4'),
        isMp4: filename.endsWith('.mp4') && !filename.includes('_flv.mp4'),
        inUploadQueue: uploadQueue.has(filename),
        inUploadHistory: uploadHistory.has(filename)
      };
    }));
    
    res.json({
      username,
      totalFiles: userFiles.length,
      files: fileDetails,
      uploadQueue: Array.from(uploadQueue.keys()).filter(f => f.includes(`TK_${username}_`)),
      uploadHistory: Array.from(uploadHistory.keys()).filter(f => f.includes(`TK_${username}_`))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;