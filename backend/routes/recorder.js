const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

// Store active recording processes
let activeRecordings = new Map();

// Start recording endpoint
router.post('/start-recording', (req, res) => {
  const { username, interval } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  if (activeRecordings.has(username)) {
    return res.status(400).json({ error: 'Recording already in progress for this user' });
  }

  try {
    // Path to the Python script
    const pythonScriptPath = path.join(__dirname, '../../src/main.py');
    
    // Command arguments for automatic mode with no update check
    const args = [
      pythonScriptPath,
      '-user', username,
      '-mode', 'automatic',
      '-automatic_interval', interval || '5',
      '-no-update-check'
    ];

    // Spawn Python process
    const pythonProcess = spawn('python3', args, {
      cwd: path.join(__dirname, '../../src'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Store the process
    activeRecordings.set(username, {
      process: pythonProcess,
      startTime: new Date(),
      interval: interval || 5,
      logs: []
    });

    // Handle process output
    pythonProcess.stdout.on('data', (data) => {
      const log = data.toString();
      console.log(`[${username}] stdout:`, log);
      
      // Store logs (keep last 100 lines)
      const recording = activeRecordings.get(username);
      if (recording) {
        recording.logs.push({ type: 'stdout', message: log, timestamp: new Date() });
        if (recording.logs.length > 100) {
          recording.logs.shift();
        }
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const log = data.toString();
      console.error(`[${username}] stderr:`, log);
      
      // Store logs
      const recording = activeRecordings.get(username);
      if (recording) {
        recording.logs.push({ type: 'stderr', message: log, timestamp: new Date() });
        if (recording.logs.length > 100) {
          recording.logs.shift();
        }
      }
    });

    pythonProcess.on('close', (code) => {
      console.log(`[${username}] Process exited with code ${code}`);
      
      // Update recording status
      const recording = activeRecordings.get(username);
      if (recording) {
        recording.exitCode = code;
        recording.endTime = new Date();
        recording.status = 'completed';
      }
      
      // Remove from active recordings after a delay to allow log retrieval
      setTimeout(() => {
        activeRecordings.delete(username);
      }, 60000); // Keep for 1 minute after completion
    });

    pythonProcess.on('error', (error) => {
      console.error(`[${username}] Process error:`, error);
      
      const recording = activeRecordings.get(username);
      if (recording) {
        recording.error = error.message;
        recording.status = 'error';
      }
    });

    res.json({ 
      message: 'Recording started successfully',
      username,
      interval: interval || 5,
      startTime: new Date()
    });

  } catch (error) {
    console.error('Error starting recording:', error);
    res.status(500).json({ error: 'Failed to start recording: ' + error.message });
  }
});

// Stop recording endpoint
router.post('/stop-recording', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const recording = activeRecordings.get(username);
  if (!recording) {
    return res.status(404).json({ error: 'No active recording found for this user' });
  }

  try {
    // Kill the Python process
    recording.process.kill('SIGTERM');
    
    // Update status
    recording.status = 'stopped';
    recording.endTime = new Date();

    res.json({ 
      message: 'Recording stopped successfully',
      username,
      endTime: new Date()
    });

  } catch (error) {
    console.error('Error stopping recording:', error);
    res.status(500).json({ error: 'Failed to stop recording: ' + error.message });
  }
});

// Get recording status
router.get('/status/:username', (req, res) => {
  const { username } = req.params;
  
  const recording = activeRecordings.get(username);
  if (!recording) {
    return res.json({ 
      isActive: false,
      username 
    });
  }

  res.json({
    isActive: !recording.endTime,
    username,
    startTime: recording.startTime,
    endTime: recording.endTime,
    interval: recording.interval,
    status: recording.status || 'running',
    error: recording.error,
    exitCode: recording.exitCode
  });
});

// Get all active recordings
router.get('/active', (req, res) => {
  const activeList = Array.from(activeRecordings.entries()).map(([username, recording]) => ({
    username,
    startTime: recording.startTime,
    endTime: recording.endTime,
    interval: recording.interval,
    status: recording.status || 'running',
    isActive: !recording.endTime
  }));

  res.json(activeList);
});

// Get logs for a specific recording
router.get('/logs/:username', (req, res) => {
  const { username } = req.params;
  
  const recording = activeRecordings.get(username);
  if (!recording) {
    return res.status(404).json({ error: 'No recording found for this user' });
  }

  res.json({
    username,
    logs: recording.logs || []
  });
});

module.exports = router;