# TikTok Live Recorder - Web Interface

A web-based interface for the TikTok Live Recorder that allows you to manage recordings through a browser.

## Features

- **Web Interface**: Easy-to-use web dashboard
- **Automatic Recording**: Set username and interval for automatic monitoring
- **Real-time Status**: View active recordings and their status
- **Start/Stop Control**: Start and stop recordings from the web interface
- **No Update Check**: Automatically runs with `--no-update-check` flag
- **Deploy Ready**: Configured for Render free tier deployment

## Project Structure

```
tiktok-live-recorder/
├── backend/           # Node.js Express server
├── frontend/          # React web interface
├── src/              # Original Python recorder code
├── package.json      # Root package.json
├── render.yaml       # Render deployment config
└── setup.sh          # Local setup script
```

## Local Development Setup

1. **Prerequisites**
   - Node.js (v14 or higher)
   - Python3 (v3.8 or higher)
   - FFmpeg

2. **Quick Setup**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

3. **Manual Setup**
   ```bash
   # Install Python dependencies
   cd src && pip3 install -r requirements.txt

   # Install backend dependencies
   cd ../backend && npm install

   # Install frontend dependencies
   cd ../frontend && npm install
   ```

4. **Development Mode**
   ```bash
   # Terminal 1: Start backend
   cd backend && npm run dev

   # Terminal 2: Start frontend
   cd frontend && npm start
   ```

5. **Production Mode**
   ```bash
   # Build frontend
   cd frontend && npm run build

   # Start production server
   cd ../backend && npm start
   ```

## Deployment to Render

1. **Connect Repository**: Connect your GitHub repository to Render

2. **Configuration**: The `render.yaml` file is already configured for deployment

3. **Environment Variables**: No additional environment variables needed

4. **Deploy**: Render will automatically build and deploy your application

## Configuration

Before using the recorder, make sure to configure:

1. **cookies.json** (in src/ directory)
   - Required for accessing TikTok content
   - See [GUIDE.md](GUIDE.md) for setup instructions

2. **telegram.json** (in src/ directory)
   - Optional: for uploading recorded videos to Telegram
   - See [GUIDE.md](GUIDE.md) for setup instructions

## Usage

1. **Access the Web Interface**
   - Local: http://localhost:3001 (development) or http://localhost:3001 (production)
   - Render: Your app's Render URL

2. **Start Recording**
   - Enter TikTok username (without @)
   - Set check interval (in minutes)
   - Click "Start Recording"

3. **Monitor Recordings**
   - View active recordings in real-time
   - See recording status and timestamps
   - Stop recordings when needed

## API Endpoints

- `POST /api/start-recording` - Start a new recording
- `POST /api/stop-recording` - Stop an active recording
- `GET /api/active` - Get all active recordings
- `GET /api/status/:username` - Get status for specific user
- `GET /api/logs/:username` - Get logs for specific recording

## Features

- **Automatic Mode**: Always runs in automatic mode with no update checks
- **Multi-user Support**: Record multiple users simultaneously
- **Real-time Updates**: Status updates every 5 seconds
- **Error Handling**: Graceful error handling and user feedback
- **Responsive Design**: Works on desktop and mobile devices

## Troubleshooting

1. **Python Dependencies**: Ensure all Python packages are installed
2. **FFmpeg**: Required for video processing
3. **Cookies**: Make sure cookies.json is properly configured
4. **Permissions**: Ensure the application has write permissions for output directory

## Notes

- The web interface automatically adds the `--no-update-check` flag
- All recordings are saved in the default output directory
- The interface shows real-time status of recording processes
- Logs are available through the API for debugging