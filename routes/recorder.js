const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const http = require('http');

const router = express.Router();

// Store active recording processes and monitoring users
let activeRecordings = new Map(); // username -> recording info
let monitoredUsers = new Map(); // username -> user info
let autoUploadTimers = new Map(); // username -> timer reference

// Helper function to notify files API about recording status using Node.js http
async function notifyFileStatus(filename, isRecording) {
  return new Promise((resolve) => {
    try {
      const method = isRecording ? 'mark-recording' : 'mark-finished';
      const port = process.env.PORT || 10000;
      const apiPath = `/api/files/${method}/${encodeURIComponent(filename)}`;
      
      const postData = JSON.stringify({});
      
      const options = {
        hostname: 'localhost',
        port: port,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅ Successfully notified: ${filename} ${isRecording ? 'started' : 'finished'}`);
          } else {
            console.log(`❌ Failed to notify file status for ${filename}: HTTP ${res.statusCode}`);
          }
          resolve();
        });
      });

      req.on('error', (error) => {
        console.log(`❌ Error notifying file status for ${filename}:`, error.message);
        resolve();
      });

      req.on('timeout', () => {
        console.log(`❌ Timeout notifying file status for ${filename}`);
        req.destroy();
        resolve();
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.log(`❌ Error notifying file status for ${filename}:`, error.message);
      resolve();
    }
  });
}

// Helper function to start auto-upload for a user's files using Node.js http
async function startAutoUpload(username) {
  return new Promise((resolve) => {
    try {
      const port = process.env.PORT || 10000;
      const apiPath = `/api/uploads/auto-upload/${encodeURIComponent(username)}`;
      
      const postData = JSON.stringify({});
      
      const options = {
        hostname: 'localhost',
        port: port,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const responseData = JSON.parse(data);
            if (res.statusCode === 200) {
              console.log(`🤖 Auto-upload started for @${username}: ${responseData.message}`);
            } else {
              console.log(`❌ Auto-upload failed for @${username}: ${responseData.error || 'Unknown error'}`);
            }
          } catch (parseError) {
            console.log(`❌ Auto-upload response parse error for @${username}:`, parseError.message);
          }
          resolve();
        });
      });

      req.on('error', (error) => {
        console.error(`❌ Error starting auto-upload for @${username}:`, error.message);
        resolve();
      });

      req.on('timeout', () => {
        console.log(`❌ Timeout starting auto-upload for @${username}`);
        req.destroy();
        resolve();
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.error(`❌ Error starting auto-upload for @${username}:`, error.message);
      resolve();
    }
  });
}

// Helper function to wait for file conversion and then schedule auto-upload
async function scheduleAutoUploadAfterConversion(username, originalFilename) {
  console.log(`⏱️ Scheduling auto-upload for @${username} after file conversion completes`);
  
  // Wait for conversion to complete (check for MP4 file)
  const recordingsDir = path.join(__dirname, '../recordings');
  const expectedMp4File = originalFilename.replace('_flv.mp4', '.mp4');
  const mp4FilePath = path.join(recordingsDir, expectedMp4File);
  
  let conversionCheckInterval;
  let conversionTimeout;
  
  // Check every 10 seconds for conversion completion
  conversionCheckInterval = setInterval(async () => {
    try {
      if (await fs.pathExists(mp4FilePath)) {
        // MP4 file exists, conversion is complete
        clearInterval(conversionCheckInterval);
        clearTimeout(conversionTimeout);
        
        console.log(`✅ Conversion completed for @${username}: ${expectedMp4File}`);
        
        // Schedule auto-upload for 5 minutes after conversion completion
        const autoUploadTimer = setTimeout(() => {
          console.log(`⏰ Auto-upload timer triggered for @${username} (5 minutes after conversion)`);
          startAutoUpload(username);
          autoUploadTimers.delete(username);
        }, 5 * 60 * 1000); // 5 minutes in milliseconds
        
        autoUploadTimers.set(username, autoUploadTimer);
        console.log(`⏰ Auto-upload scheduled for @${username} in 5 minutes (after conversion)`);
      }
    } catch (error) {
      console.error(`❌ Error checking conversion status for @${username}:`, error.message);
    }
  }, 10000); // Check every 10 seconds
  
  // Set a timeout to stop checking after 10 minutes
  conversionTimeout = setTimeout(() => {
    clearInterval(conversionCheckInterval);
    console.log(`⚠️ Conversion timeout for @${username} - stopping auto-upload scheduling`);
  }, 10 * 60 * 1000); // 10 minutes timeout
}

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Recorder API is working', timestamp: new Date().toISOString() });
});

// Get all monitored users
router.get('/monitored', (req, res) => {
  const users = Array.from(monitoredUsers.entries()).map(([username, info]) => ({
    username,
    ...info,
    isRecording: activeRecordings.has(username) && activeRecordings.get(username).status === 'recording',
    hasAutoUploadScheduled: autoUploadTimers.has(username)
  }));
  res.json(users);
});

// Add user to monitoring list
router.post('/monitor', (req, res) => {
  const { username, interval } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanUsername = username.replace('@', '').trim();
  
  if (monitoredUsers.has(cleanUsername)) {
    return res.status(400).json({ error: 'User is already being monitored' });
  }

  // Add to monitored users
  monitoredUsers.set(cleanUsername, {
    interval: interval || 5,
    addedAt: new Date(),
    status: 'monitoring'
  });

  // Start monitoring process
  startMonitoring(cleanUsername, interval || 5);

  res.json({ 
    message: 'User added to monitoring list',
    username: cleanUsername,
    interval: interval || 5
  });
});

// Remove user from monitoring
router.delete('/monitor/:username', (req, res) => {
  const { username } = req.params;
  
  // Cancel any pending auto-upload
  if (autoUploadTimers.has(username)) {
    clearTimeout(autoUploadTimers.get(username));
    autoUploadTimers.delete(username);
    console.log(`🚫 Cancelled auto-upload timer for @${username}`);
  }
  
  // Stop any active recording gracefully
  if (activeRecordings.has(username)) {
    const recording = activeRecordings.get(username);
    if (recording.process && !recording.process.killed) {
      // Send SIGTERM for graceful shutdown, allowing post-processing
      recording.process.kill('SIGTERM');
      
      // Mark as stopping
      recording.status = 'stopping';
      
      // Notify that recording is finishing
      if (recording.filename) {
        notifyFileStatus(recording.filename, false);
      }
      
      // Wait a bit for graceful shutdown, then force kill if needed
      setTimeout(() => {
        if (recording.process && !recording.process.killed) {
          console.log(`[${username}] Force killing process after graceful shutdown timeout`);
          recording.process.kill('SIGKILL');
        }
      }, 30000); // 30 seconds for post-processing
    }
  }

  // Remove from monitoring
  if (monitoredUsers.has(username)) {
    monitoredUsers.delete(username);
    res.json({ message: `Stopped monitoring @${username} (allowing current recording to finish)` });
  } else {
    res.status(404).json({ error: 'User not found in monitoring list' });
  }
});

// Get recording status
router.get('/status/:username', (req, res) => {
  const { username } = req.params;
  
  const recording = activeRecordings.get(username);
  const monitored = monitoredUsers.get(username);
  
  if (!recording && !monitored) {
    return res.json({ 
      isMonitored: false,
      isRecording: false,
      username 
    });
  }

  res.json({
    isMonitored: !!monitored,
    isRecording: !!recording && recording.status === 'recording',
    username,
    monitorInfo: monitored,
    recordingInfo: recording ? {
      startTime: recording.startTime,
      status: recording.status,
      filename: recording.filename
    } : null,
    hasAutoUploadScheduled: autoUploadTimers.has(username)
  });
});

// Get all active recordings
router.get('/active', (req, res) => {
  const activeList = Array.from(activeRecordings.entries()).map(([username, recording]) => ({
    username,
    startTime: recording.startTime,
    status: recording.status,
    filename: recording.filename
  }));

  res.json(activeList);
});

// Get auto-upload timers status
router.get('/auto-upload-status', (req, res) => {
  const timers = Array.from(autoUploadTimers.entries()).map(([username, timer]) => ({
    username,
    scheduled: true,
    timerId: timer._idleTimeout // Approximate time remaining
  }));

  res.json({
    scheduledUploads: timers,
    count: autoUploadTimers.size
  });
});

// Cancel auto-upload for a specific user
router.delete('/cancel-auto-upload/:username', (req, res) => {
  const { username } = req.params;
  
  if (autoUploadTimers.has(username)) {
    clearTimeout(autoUploadTimers.get(username));
    autoUploadTimers.delete(username);
    
    console.log(`🚫 Cancelled auto-upload timer for @${username}`);
    res.json({ 
      success: true,
      message: `Auto-upload cancelled for @${username}` 
    });
  } else {
    res.status(404).json({ 
      error: `No auto-upload scheduled for @${username}` 
    });
  }
});

// Start monitoring function
function startMonitoring(username, interval) {
  const pythonScriptPath = path.join(__dirname, '../src/main.py');
  const recordingsDir = path.join(__dirname, '../recordings');
  
  // Ensure recordings directory exists
  fs.ensureDirSync(recordingsDir);
  
  const args = [
    pythonScriptPath,
    '-user', username,
    '-mode', 'automatic',
    '-automatic_interval', interval.toString(),
    '-output', recordingsDir + '/',
    '-no-update-check',
    '--no-banner'
  ];

  console.log(`🎯 Starting monitoring for @${username} with ${interval}min interval`);

  const pythonProcess = spawn('python3', args, {
    cwd: path.join(__dirname, '../src'),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Store the process
  activeRecordings.set(username, {
    process: pythonProcess,
    startTime: new Date(),
    status: 'monitoring',
    logs: [],
    filename: null,
    recordingEndTime: null
  });

  // Handle process output
  pythonProcess.stdout.on('data', (data) => {
    const log = data.toString().trim();
    console.log(`[${username}] INFO: ${log}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      recording.logs.push({ type: 'info', message: log, timestamp: new Date() });
      
      // Check if recording started
      if (log.includes('Started recording')) {
        console.log(`🎬 Recording started for @${username}`);
        recording.status = 'recording';
        
        // Cancel any existing auto-upload timer since new recording started
        if (autoUploadTimers.has(username)) {
          clearTimeout(autoUploadTimers.get(username));
          autoUploadTimers.delete(username);
          console.log(`🚫 Cancelled previous auto-upload timer for @${username} (new recording started)`);
        }
        
        // Extract filename from log - look for the FLV filename pattern
        const filenameMatch = log.match(/TK_[^_]+_[^_]+_[^.]+_flv\.mp4/);
        
        if (filenameMatch) {
          recording.filename = filenameMatch[0];
          console.log(`📁 Recording filename: ${recording.filename}`);
          
          // Notify files API that recording started
          notifyFileStatus(recording.filename, true);
        } else {
          // If we can't find the filename in the log, generate expected filename
          const timestamp = new Date().toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..+/, '')
            .replace('T', '_')
            .slice(0, 15);
          const expectedFilename = `TK_${username}_${timestamp}_flv.mp4`;
          recording.filename = expectedFilename;
          console.log(`📁 Generated filename: ${recording.filename}`);
          
          // Notify files API that recording started
          notifyFileStatus(recording.filename, true);
        }
      }
      
      // Check if recording finished
      if (log.includes('Recording finished')) {
        console.log(`🏁 Recording finished for @${username}`);
        recording.recordingEndTime = new Date();
        
        if (recording.filename) {
          console.log(`📤 Processing finished recording: ${recording.filename}`);
          
          // Notify files API that recording finished
          notifyFileStatus(recording.filename, false);
          
          // Schedule auto-upload after conversion completes
          scheduleAutoUploadAfterConversion(username, recording.filename);
        }
        
        recording.status = 'monitoring';
        recording.filename = null;
      }
      
      // Check for conversion completion
      if (log.includes('Finished converting') || log.includes('already in MP4 format')) {
        console.log(`✅ Conversion process completed for @${username}`);
      }
      
      // Keep only last 50 logs
      if (recording.logs.length > 50) {
        recording.logs = recording.logs.slice(-50);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const log = data.toString().trim();
    
    // Don't treat all stderr as errors - some are just info messages
    if (log.includes('[!]') || log.includes('ERROR') || log.includes('error:')) {
      console.error(`[${username}] ERROR: ${log}`);
    } else {
      console.log(`[${username}] INFO: ${log}`);
    }
    
    const recording = activeRecordings.get(username);
    if (recording) {
      const logType = (log.includes('[!]') || log.includes('ERROR') || log.includes('error:')) ? 'error' : 'info';
      recording.logs.push({ type: logType, message: log, timestamp: new Date() });
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`[${username}] Process exited with code ${code}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      // Notify that any active recording is finished
      if (recording.filename) {
        notifyFileStatus(recording.filename, false);
      }
      
      recording.status = 'stopped';
      recording.exitCode = code;
    }
    
    // If user is still monitored and process wasn't manually stopped, restart
    if (monitoredUsers.has(username) && code !== 0) {
      console.log(`[${username}] Restarting monitoring in 30 seconds...`);
      setTimeout(() => {
        if (monitoredUsers.has(username)) {
          startMonitoring(username, monitoredUsers.get(username).interval);
        }
      }, 30000);
    }
  });

  pythonProcess.on('error', (error) => {
    console.error(`[${username}] Process error:`, error);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      // Notify that recording failed
      if (recording.filename) {
        notifyFileStatus(recording.filename, false);
      }
      
      recording.error = error.message;
      recording.status = 'error';
    }
  });
}

// Get logs for a specific user
router.get('/logs/:username', (req, res) => {
  const { username } = req.params;
  
  const recording = activeRecordings.get(username);
  if (!recording) {
    return res.status(404).json({ error: 'No monitoring found for this user' });
  }

  res.json({
    username,
    logs: recording.logs || []
  });
});

// Helper function to check for completed recordings
async function checkForCompletedRecordings(username) {
  try {
    const recordingsDir = path.join(__dirname, '../recordings');
    const files = await fs.readdir(recordingsDir);
    
    // Look for MP4 files for this user
    const userMp4Files = files.filter(file => 
      file.includes(`TK_${username}_`) && 
      file.endsWith('.mp4') &&
      !file.includes('_flv.')
    );
    
    if (userMp4Files.length > 0) {
      console.log(`📁 Found ${userMp4Files.length} completed recordings for ${username}`);
    }
  } catch (error) {
    console.error(`❌ Error checking for completed recordings for ${username}:`, error);
  }
}

module.exports = router;