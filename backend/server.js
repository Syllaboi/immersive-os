const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const Docker = require('dockerode');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const db = new sqlite3.Database('./data/database.sqlite');

const MAX_INSTANCES = 2;

// Initialize Database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      lat REAL,
      lng REAL,
      container_id TEXT,
      status TEXT DEFAULT 'stopped'
    )
  `);
});

// Utility to create directories for profile data
const getProfileDataPath = (profileId) => {
  const p = path.join(__dirname, 'profiles', `profile_${profileId}`);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
  return p;
};

// WebSocket for real-time notifications
wss.on('connection', (ws) => {
  console.log('Client connected for live updates');
  ws.on('message', (message) => {
    // We will receive messages from the Android NotificationTracker here
    try {
      const data = JSON.parse(message);
      // Broadcast to all connected clients (the phone app)
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (e) {
      console.error('Error parsing WS message', e);
    }
  });
});

// API Routes
app.get('/api/profiles', (req, res) => {
  db.all('SELECT * FROM profiles', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/profiles', (req, res) => {
  const { name, location, lat, lng } = req.body;
  db.run('INSERT INTO profiles (name, location, lat, lng) VALUES (?, ?, ?, ?)', [name, location, lat, lng], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, location, lat, lng, status: 'stopped' });
  });
});

app.delete('/api/profiles/:id', (req, res) => {
  const id = req.params.id;
  // TODO: Also delete the docker container and data folder if it exists
  db.run('DELETE FROM profiles WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post('/api/profiles/:id/start', async (req, res) => {
  const id = req.params.id;

  // Check instance limit
  db.all("SELECT COUNT(*) as count FROM profiles WHERE status = 'running'", async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows[0].count >= MAX_INSTANCES) {
      return res.status(400).json({ error: `Maximum of ${MAX_INSTANCES} instances are allowed running at once.` });
    }

    db.get('SELECT * FROM profiles WHERE id = ?', [id], async (err, profile) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      if (profile.status === 'running') return res.json({ success: true, message: 'Already running' });

      try {
        const containerName = `redroid_${id}`;
        const dataPath = getProfileDataPath(id);

        let container = docker.getContainer(containerName);
        let containerInfo;
        try {
           containerInfo = await container.inspect();
        } catch (e) {
           containerInfo = null;
        }

        if (!containerInfo) {
          container = await docker.createContainer({
            Image: 'redroid/redroid:11.0.0-latest', // Using Android 11 for lower memory footprint
            name: containerName,
            Privileged: true,
            Cmd: [
              'androidboot.use_memfd=1',
              'androidboot.redroid_width=720',
              'androidboot.redroid_height=1280',
              'androidboot.redroid_dpi=320'
            ],
            HostConfig: {
              Binds: [
                `${dataPath}:/data`, // Persist Android data
                '/dev/binderfs:/dev/binderfs' // Required for Ubuntu 24.04
              ],
              NetworkMode: 'backend_default' // Attach to docker-compose network
            }
          });
        }

        await container.start();
        
        // Wait a bit for adb to start, then set location
        setTimeout(async () => {
          console.log(`Setting location for profile ${id} to ${profile.lat}, ${profile.lng}`);
          try {
             // 1. Set location via cmd location
             exec(`docker exec ${containerName} /system/bin/cmd location set-location ${profile.lat},${profile.lng}`, (err, stdout, stderr) => {
                 if (err) console.error('Error setting location:', err.message);
                 else console.log('Location set successfully.');
             });
             
             // 2. Install NotificationTracker APK
             // We copy it into the container first (handled by mapping it directly if we run on host, but from backend container we can use docker cp or since backend has access to docker socket, use docker CLI)
             exec(`docker cp /app/app-debug.apk ${containerName}:/data/local/tmp/app-debug.apk && docker exec ${containerName} pm install -r /data/local/tmp/app-debug.apk`, (err, stdout, stderr) => {
                 if (err) console.error('Error installing APK:', err.message);
                 else {
                     console.log('APK installed successfully.');
                     // Start the MainActivity to prompt for notification permission
                     exec(`docker exec ${containerName} am start -n com.cloudandroid.tracker/.MainActivity`);
                 }
             });

             // 3. Connect ws-scrcpy to the redroid container
             const wsScrcpyName = 'backend-ws-scrcpy-1'; 
             exec(`docker exec ${wsScrcpyName} adb connect ${containerName}:5555`, (err, stdout, stderr) => {
                 if (err) console.error('Error connecting adb in ws-scrcpy:', err.message);
                 else console.log(`Connected ws-scrcpy to ${containerName}:5555`);
             });
          } catch(e) {
             console.error('Error during post-start setup', e);
          }
        }, 5000);

        db.run("UPDATE profiles SET status = 'running', container_id = ? WHERE id = ?", [container.id, id], (err) => {
            if (err) console.error(err);
            res.json({ success: true, container_id: container.id });
        });

      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  });
});

app.post('/api/profiles/:id/stop', async (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM profiles WHERE id = ?', [id], async (err, profile) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!profile || profile.status === 'stopped') return res.json({ success: true });

    try {
      const containerName = `redroid_${id}`;
      const container = docker.getContainer(containerName);
      await container.stop();
      
      db.run("UPDATE profiles SET status = 'stopped' WHERE id = ?", [id], (err) => {
          if (err) console.error(err);
          res.json({ success: true });
      });
    } catch (error) {
       // If container is already stopped or missing, just update DB
       db.run("UPDATE profiles SET status = 'stopped' WHERE id = ?", [id], () => {
          res.json({ success: true });
       });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
