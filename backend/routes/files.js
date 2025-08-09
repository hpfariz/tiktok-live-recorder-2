const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const router = express.Router();

const recordingsDir = path.join(__dirname, '../recordings');

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
          isCurrentlyRecording: filename.includes('_flv.') && 
                               await isFileBeingWritten(filePath)
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
      isCurrentlyRecording: filename.includes('_flv.') && 
                           await isFileBeingWritten(filePath)
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

// Helper function to check if file is being written to
async function isFileBeingWritten(filePath) {
  try {
    const stats1 = await fs.stat(filePath);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    const stats2 = await fs.stat(filePath);
    
    // If size changed, file is being written to
    return stats1.size !== stats2.size;
  } catch {
    return false;
  }
}

module.exports = router;