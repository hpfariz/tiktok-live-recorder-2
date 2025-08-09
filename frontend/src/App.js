import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';

function App() {
  const [username, setUsername] = useState('');
  const [interval, setInterval] = useState(5);
  const [activeRecordings, setActiveRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  // Fetch active recordings on component mount and then periodically
  useEffect(() => {
    fetchActiveRecordings();
    const intervalId = setInterval(fetchActiveRecordings, 5000); // Poll every 5 seconds
    return () => clearInterval(intervalId);
  }, []);

  const fetchActiveRecordings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/active`);
      if (response.ok) {
        const data = await response.json();
        setActiveRecordings(data);
      }
    } catch (error) {
      console.error('Error fetching active recordings:', error);
    }
  };

  const showMessage = (text, type = 'success') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 5000);
  };

  const startRecording = async (e) => {
    e.preventDefault();
    
    if (!username.trim()) {
      showMessage('Please enter a username', 'error');
      return;
    }

    setLoading(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/start-recording`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim().replace('@', ''),
          interval: interval
        }),
      });

      const data = await response.json();

      if (response.ok) {
        showMessage(`Recording started for @${data.username}`, 'success');
        setUsername('');
        fetchActiveRecordings();
      } else {
        showMessage(data.error || 'Failed to start recording', 'error');
      }
    } catch (error) {
      showMessage('Failed to start recording: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = async (username) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/stop-recording`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (response.ok) {
        showMessage(`Recording stopped for @${username}`, 'success');
        fetchActiveRecordings();
      } else {
        showMessage(data.error || 'Failed to stop recording', 'error');
      }
    } catch (error) {
      showMessage('Failed to stop recording: ' + error.message, 'error');
    }
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (recording) => {
    if (recording.status === 'error') {
      return <span className="status-badge status-error">Error</span>;
    }
    if (recording.status === 'completed') {
      return <span className="status-badge status-completed">Completed</span>;
    }
    if (recording.status === 'stopped') {
      return <span className="status-badge status-stopped">Stopped</span>;
    }
    if (recording.isActive) {
      return <span className="status-badge status-running">Running</span>;
    }
    return <span className="status-badge status-completed">Completed</span>;
  };

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🎥 TikTok Live Recorder</h1>
          <p>Record TikTok live streams automatically</p>
        </header>

        <div className="main-content">
          <div className="card">
            <h2>Start New Recording</h2>
            <form onSubmit={startRecording}>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="username">TikTok Username</label>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username (without @)"
                    disabled={loading}
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="interval">Check Interval (minutes)</label>
                  <input
                    type="number"
                    id="interval"
                    value={interval}
                    onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    min="1"
                    max="60"
                    disabled={loading}
                  />
                </div>
                
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading && <span className="loading"></span>}
                  Start Recording
                </button>
              </div>
            </form>

            {message && (
              <div className={`${messageType === 'error' ? 'error-message' : 'success-message'}`}>
                {message}
              </div>
            )}
          </div>

          <div className="card">
            <div className="status-section">
              <h3>System Status</h3>
              <div className="recording-details">
                <div><strong>Active Recordings:</strong> {activeRecordings.filter(r => r.isActive).length}</div>
                <div><strong>Total Sessions:</strong> {activeRecordings.length}</div>
                <div><strong>Mode:</strong> Automatic with no update check</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card active-recordings">
          <h3>Recording Sessions</h3>
          
          {activeRecordings.length === 0 ? (
            <div className="empty-state">
              No recording sessions found. Start a new recording above.
            </div>
          ) : (
            activeRecordings.map((recording) => (
              <div 
                key={recording.username} 
                className={`recording-item ${recording.status || (recording.isActive ? 'running' : 'completed')}`}
              >
                <div className="recording-header">
                  <span className="recording-username">@{recording.username}</span>
                  {getStatusBadge(recording)}
                </div>
                
                <div className="recording-details">
                  <div><strong>Started:</strong> {formatDateTime(recording.startTime)}</div>
                  {recording.endTime && (
                    <div><strong>Ended:</strong> {formatDateTime(recording.endTime)}</div>
                  )}
                  <div><strong>Check Interval:</strong> {recording.interval} minutes</div>
                  {recording.error && (
                    <div style={{color: '#d32f2f'}}><strong>Error:</strong> {recording.error}</div>
                  )}
                </div>

                {recording.isActive && (
                  <div className="recording-actions">
                    <button
                      onClick={() => stopRecording(recording.username)}
                      className="btn btn-danger btn-small"
                    >
                      Stop Recording
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;