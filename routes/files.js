const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const router = express.Router();

const recordingsDir = path.join(__dirname, '../recordings');

// Store active recording processes to track what's currently recording
let activeRecordings = new Set(); // Set of filenames currently being recorded

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
  console.log(`Marked ${filename} as actively recording`);
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
  }
  
  console.log(`Marked ${filename} as finished recording`);
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
        
        // First check our active recordings tracker
        if (isActivelyRecording(filename)) {
          isCurrentlyRecording = true;
        } else if (filename.includes('_flv.')) {
          // For .flv files, also check if file size is changing
          isCurrentlyRecording = await isFileBeingWritten(filePath);
        } else {
          // For .mp4 files, check if corresponding .flv file exists and is being written
          const flvVersion = filename.replace('.mp4', '_flv.mp4');
          const flvPath = path.join(recordingsDir, flvVersion);
          
          if (await fs.pathExists(flvPath)) {
            // If .flv exists, .mp4 is not the active recording
            isCurrentlyRecording = false;
          } else {
            // No .flv file, check if .mp4 is being written directly
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
    
    // Wait a bit longer for more accurate detection
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    const stats2 = await fs.stat(filePath);
    
    // Check both size and modification time
    const sizeChanged = stats1.size !== stats2.size;
    const timeChanged = Math.abs(stats2.mtime.getTime() - stats1.mtime.getTime()) < 5000; // Modified within last 5 seconds
    
    return sizeChanged || timeChanged;
  } catch {
    return false;
  }
}

module.exports = router;