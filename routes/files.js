const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const router = express.Router();

const recordingsDir = path.join(__dirname, '../recordings');

// Store active recording processes to track what's currently recording
let activeRecordings = new Set(); // Set of filenames currently being recorded

// Get recent file operations log
let fileOperationsLog = [];

function logFileOperation(operation, filename, details = '') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation,
    filename,
    details
  };
  
  fileOperationsLog.push(logEntry);
  
  // Keep only last 100 operations
  if (fileOperationsLog.length > 100) {
    fileOperationsLog = fileOperationsLog.slice(-100);
  }
}

// Function to check if a process is actively recording a file
function isActivelyRecording(filename) {
  // Check if this file is in our active recordings set
  if (activeRecordings.has(filename)) {
    return true;
  }

  // Also check for .flv files that might still be converting
  const flvVersion = filename.replace('.mp4', '_flv.mp4');
  if (activeRecordings.has(flvVersion)) {
    return true;
  }

  return false;
}

// API endpoint to mark files as actively recording (called by recorder)
router.post('/mark-recording/:filename', (req, res) => {
  const { filename } = req.params;
  activeRecordings.add(filename);
  logFileOperation('MARK_RECORDING', filename, 'File marked as actively recording');
  res.json({ success: true, message: `${filename} marked as recording` });
});

// API endpoint to mark files as finished recording (called by recorder)
router.post('/mark-finished/:filename', (req, res) => {
  const { filename } = req.params;
  activeRecordings.delete(filename);
  
  // Also remove the .mp4 version if .flv finished
  if (filename.includes('_flv.mp4')) {
    const mp4Version = filename.replace('_flv.mp4', '.mp4');
    activeRecordings.delete(mp4Version);
    logFileOperation('MARK_FINISHED', filename, `Also cleared ${mp4Version}`);
  } else {
    logFileOperation('MARK_FINISHED', filename, 'File marked as finished recording');
  }
  
  res.json({ success: true, message: `${filename} marked as finished` });
});

// Get all recorded files
router.get('/', async (req, res) => {
  try {
    await fs.ensureDir(recordingsDir);
    const files = await fs.readdir(recordingsDir);
    
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || file.endsWith('.flv')
    );

    const fileDetails = await Promise.all(
      videoFiles.map(async (filename) => {
        const filePath = path.join(recordingsDir, filename);
        const stats = await fs.stat(filePath);
        
        // Parse filename to extract info (TK_username_date_type.ext)
        const match = filename.match(/TK_([^_]+)_([^_]+)_([^.]+)\.(.+)/);
        let username = 'unknown';
        let recordDate = 'unknown';
        let type = 'unknown';
        
        if (match) {
          username = match[1];
          recordDate = match[2];
          type = match[3];
        }

        // Determine if file is currently being recorded
        let isCurrentlyRecording = false;
        
        // First check our active recordings tracker (most reliable)
        if (isActivelyRecording(filename)) {
          isCurrentlyRecording = true;
        } else {
          // Only check file writing if not in active recordings
          // This prevents false positives after recording stops
          const fileAge = Date.now() - stats.mtime.getTime();
          
          // If file is older than 2 minutes, don't bother checking if it's being written
          if (fileAge > 120000) { // 2 minutes
            isCurrentlyRecording = false;
          } else {
            // File is recent, check if it's being written
            isCurrentlyRecording = await isFileBeingWritten(filePath);
          }
        }

        return {
          filename,
          path: filePath,
          size: stats.size,
          sizeFormatted: formatFileSize(stats.size),
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          username,
          recordDate,
          type,
          extension: filename.split('.').pop(),
          isCurrentlyRecording
        };
      })
    );

    // Sort by creation date (newest first)
    fileDetails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(fileDetails);
  } catch (error) {
    console.error('Error reading files:', error);
    res.status(500).json({ error: 'Failed to read recordings directory' });
  }
});

// Download a specific file
router.get('/download/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(recordingsDir, filename);
  
  // Security check - ensure file is in recordings directory
  const resolvedPath = path.resolve(filePath);
  const resolvedRecordingsDir = path.resolve(recordingsDir);
  
  if (!resolvedPath.startsWith(resolvedRecordingsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Don't allow download of files currently being recorded
  if (isActivelyRecording(filename)) {
    return res.status(423).json({ error: 'File is currently being recorded and cannot be downloaded' });
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    }
  });
});

// Delete a specific file
router.delete('/:filename', async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(recordingsDir, filename);
  
  // Security check
  const resolvedPath = path.resolve(filePath);
  const resolvedRecordingsDir = path.resolve(recordingsDir);
  
  if (!resolvedPath.startsWith(resolvedRecordingsDir)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Don't allow deletion of files currently being recorded
  if (isActivelyRecording(filename)) {
    return res.status(423).json({ error: 'Cannot delete file that is currently being recorded' });
  }

  try {
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    await fs.remove(filePath);
    res.json({ message: 'File deleted successfully', filename });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Get file info
router.get('/info/:filename', async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(recordingsDir, filename);
  
  try {
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = await fs.stat(filePath);
    
    res.json({
      filename,
      size: stats.size,
      sizeFormatted: formatFileSize(stats.size),
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      isCurrentlyRecording: isActivelyRecording(filename) || 
                           (filename.includes('_flv.') && await isFileBeingWritten(filePath))
    });
  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Get active recordings status
router.get('/active-recordings', (req, res) => {
  res.json({
    activeRecordings: Array.from(activeRecordings),
    count: activeRecordings.size
  });
});

// Debug endpoint to see what's happening with file tracking
router.get('/debug/status', (req, res) => {
  res.json({
    activeRecordings: Array.from(activeRecordings),
    recordingsCount: activeRecordings.size,
    timestamp: new Date().toISOString()
  });
});

// Endpoint to get file operations log
router.get('/debug/operations', (req, res) => {
  res.json({
    operations: fileOperationsLog.slice(-50), // Last 50 operations
    total: fileOperationsLog.length
  });
});

// Force mark a file as finished (for manual intervention)
router.post('/debug/force-finish/:filename', (req, res) => {
  const { filename } = req.params;
  activeRecordings.delete(filename);
  logFileOperation('FORCE_FINISHED', filename, 'Manually marked as finished');
  res.json({ success: true, message: `${filename} force marked as finished` });
});

// Clear all stuck recordings - useful when files are stuck in "recording" state
router.post('/debug/clear-stuck', async (req, res) => {
  try {
    const recordingsPath = path.join(__dirname, '../recordings');
    const files = await fs.readdir(recordingsPath);
    
    let clearedCount = 0;
    
    // Check each file that might be stuck
    for (const filename of files) {
      if (filename.endsWith('.mp4')) {
        const filePath = path.join(recordingsPath, filename);
        const stats = await fs.stat(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        
        // If file hasn't been modified in 2+ minutes, clear it from active recordings
        if (fileAge > 120000 && activeRecordings.has(filename)) {
          activeRecordings.delete(filename);
          logFileOperation('CLEAR_STUCK', filename, `File age: ${Math.round(fileAge/1000)}s`);
          clearedCount++;
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: `Cleared ${clearedCount} stuck recordings`,
      clearedCount 
    });
  } catch (error) {
    console.error('Error clearing stuck recordings:', error);
    res.status(500).json({ error: 'Failed to clear stuck recordings' });
  }
});

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to check if file is being written to (improved version)
async function isFileBeingWritten(filePath) {
  try {
    const stats1 = await fs.stat(filePath);
    
    // Wait for changes
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
    
    const stats2 = await fs.stat(filePath);
    
    // Check if size changed (most reliable indicator)
    const sizeChanged = stats1.size !== stats2.size;
    
    // Only consider modification time if size also changed
    // This prevents false positives from system file access
    const recentlyModified = (Date.now() - stats2.mtime.getTime()) < 10000; // Modified within last 10 seconds
    
    // File is being written if size changed OR (recently modified AND size > 0)
    const isBeingWritten = sizeChanged || (recentlyModified && stats2.size > 0 && sizeChanged);
    
    return isBeingWritten;
  } catch (error) {
    return false;
  }
}

module.exports = router;