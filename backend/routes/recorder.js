const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const router = express.Router();

// Store active recording processes and monitoring users
let activeRecordings = new Map(); // username -> recording info
let monitoredUsers = new Map(); // username -> user info

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
  
  // Stop any active recording
  if (activeRecordings.has(username)) {
    const recording = activeRecordings.get(username);
    if (recording.process && !recording.process.killed) {
      recording.process.kill('SIGTERM');
    }
    activeRecordings.delete(username);
  }

  // Remove from monitoring
  if (monitoredUsers.has(username)) {
    monitoredUsers.delete(username);
    res.json({ message: `Stopped monitoring @${username}` });
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
    '-no-update-check'
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
    console.log(`[${username}] ${log}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      recording.logs.push({ type: 'stdout', message: log, timestamp: new Date() });
      
      // Check if recording started
      if (log.includes('Started recording')) {
        recording.status = 'recording';
        const match = log.match(/TK_([^_]+)_([^_]+)_/);
        if (match) {
          recording.filename = `TK_${match[1]}_${match[2]}_flv.mp4`;
        }
      }
      
      // Check if recording finished
      if (log.includes('Recording finished')) {
        recording.status = 'monitoring';
        recording.filename = null;
      }
      
      // Keep only last 50 logs
      if (recording.logs.length > 50) {
        recording.logs = recording.logs.slice(-50);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const log = data.toString();
    console.error(`[${username}] ERROR: ${log}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
      recording.logs.push({ type: 'stderr', message: log, timestamp: new Date() });
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`[${username}] Process exited with code ${code}`);
    
    const recording = activeRecordings.get(username);
    if (recording) {
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

module.exports = router;