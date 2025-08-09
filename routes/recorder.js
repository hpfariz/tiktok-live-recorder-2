const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const router = express.Router();

// Store active recording processes and monitoring users
let activeRecordings = new Map(); // username -> recording info
let monitoredUsers = new Map(); // username -> user info

// Helper function to notify files API about recording status
async function notifyFileStatus(filename, isRecording) {
  try {
    const method = isRecording ? 'mark-recording' : 'mark-finished';
    const response = await fetch(`http://localhost:${process.env.PORT || 10000}/api/files/${method}/${filename}`, {
      method: 'POST'
    });
    if (!response.ok) {
      console.log(`Failed to notify file status for ${filename}: ${response.statusText}`);
    }
  } catch (error) {
    console.log(`Error notifying file status for ${filename}:`, error.message);
  }
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
    isRecording: activeRecordings.has(username) && activeRecordings.get(username).status === 'recording'
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
    } : null
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

  console.log(`Starting monitoring for @${username} with ${interval}min interval`);

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
    filename: null
  });

  // Handle process output
  pythonProcess.stdout.on('data', (data) => {
    const log = data.toString();
    console.log(`[${username}] INFO: ${log}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      recording.logs.push({ type: 'info', message: log, timestamp: new Date() });
      
      // Check if recording started
      if (log.includes('Started recording')) {
        recording.status = 'recording';
        
        // Extract filename from log - it should be the actual MP4 filename
        const filenameMatch = log.match(/TK_[^_]+_[^_]+_[^.]+\.mp4/);
        if (filenameMatch) {
          recording.filename = filenameMatch[0];
          console.log(`Recording started: ${recording.filename}`);
          
          // Notify files API that recording started
          notifyFileStatus(recording.filename, true);
        }
      }
      
      // Check if recording finished
      if (log.includes('Recording finished')) {
        if (recording.filename) {
          console.log(`Recording finished: ${recording.filename}`);
          
          // Notify files API that recording finished
          notifyFileStatus(recording.filename, false);
        }
        
        recording.status = 'monitoring';
        recording.filename = null;
      }
      
      // Check for conversion messages (but files are already MP4)
      if (log.includes('already in MP4 format') || log.includes('skipping conversion')) {
        console.log(`File already in MP4 format, no conversion needed`);
      }
      
      // Check for actual conversion completion (if it happens)
      if (log.includes('Finished converting')) {
        const convertedMatch = log.match(/Finished converting (.*)/);
        if (convertedMatch) {
          const convertedFile = path.basename(convertedMatch[1]);
          console.log(`Conversion completed for: ${convertedFile}`);
        }
      }
      
      // Keep only last 50 logs
      if (recording.logs.length > 50) {
        recording.logs = recording.logs.slice(-50);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const log = data.toString();
    
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
      
      // Check for converted MP4 files and auto-upload if they exist
      setTimeout(() => {
        checkAndAutoUpload(username);
      }, 5000); // Wait 5 seconds for any final file operations
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

// Helper function to check for completed recordings and auto-upload
async function checkAndAutoUpload(username) {
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
      console.log(`Found ${userMp4Files.length} completed recordings for ${username}`);
      // Note: Auto-upload can be implemented later if needed
      // For now, just log the available files
    }
  } catch (error) {
    console.error(`Error checking for completed recordings for ${username}:`, error);
  }
}

module.exports = router;