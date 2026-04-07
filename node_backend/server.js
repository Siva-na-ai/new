const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SECRET_KEY = 'vshield-vision-gate-secure-key-2024'; // In production, use env variable

app.use(cors());
app.use(express.json());

// Directories
const BASE_DIR = path.resolve(__dirname, '../backend');
const ALARM_DIR = path.resolve(__dirname, '../alarm');
const UPLOADS_DIR = path.resolve(__dirname, '../backend/uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Static Files
app.use('/api/media/uploads', express.static(UPLOADS_DIR));
app.use('/alarm', express.static(ALARM_DIR));

// Upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Webhook for Python Worker to trigger alerts
app.post('/api/internal/socket-trigger', async (req, res) => {
  const { type, data } = req.body;
  if (type === 'alert') {
    io.emit('new_alert', data); // Broadcast to UI
  } else if (type === 'vehicle') {
    io.emit('new_vehicle', data);
  } else if (type === 'camera_status') {
    io.emit('camera_status', data);
  }
  res.json({ success: true });
});

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ detail: "Authentication required" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ detail: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

app.get('/api/alarm-sound', (req, res) => {
  const soundFile = path.join(ALARM_DIR, 'clip-1773994393607.mp3');
  if (fs.existsSync(soundFile)) {
    res.sendFile(soundFile);
  } else {
    res.status(404).json({ error: "Sound file not found" });
  }
});

app.post('/api/upload-video', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({
    status: "success",
    filename: req.file.filename,
    path: req.file.path,
    url: `/uploads/${req.file.filename}`
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username ILIKE $1', [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      
      if (isMatch) {
        const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
        return res.json({ status: "success", username: user.username, token });
      }
    }
    return res.status(401).json({ detail: "Security Alert: Access denied. Please verify your credentials." });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ detail: "Internal Server Error" });
  }
});

app.get('/api/test_camera', (req, res) => {
  // Simplified camera test - worker will handle actual connection and reconnection
  const { ip_address } = req.query;
  res.json({ status: "success", url: ip_address });
});

// Camera endpoints
app.post('/api/cameras', authenticateToken, async (req, res) => {
  const params = Object.keys(req.body).length > 0 ? req.body : req.query;
  const { ip_address, place_name, detections } = params;
  
  const detList = detections ? detections.split(',').map(i => i.trim().toLowerCase()) : [];
  
  try {
    const r = await pool.query(
      'INSERT INTO cameras (ip_address, place_name, detections_to_run, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [ip_address, place_name, JSON.stringify(detList), true]
    );
    const cam = r.rows[0];
    
    // Start worker async
    axios.post(`http://127.0.0.1:8001/start/${cam.id}`, { source: ip_address }).catch(e => console.error("Worker error HTTP start:", e.message));
    
    res.json(cam);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.put('/api/cameras/:id', authenticateToken, async (req, res) => {
  const params = Object.keys(req.body).length > 0 ? req.body : req.query;
  const { ip_address, place_name, detections } = params;
  const detList = detections ? detections.split(',').map(i => i.trim().toLowerCase()) : [];
  
  try {
    const r = await pool.query(
      'UPDATE cameras SET ip_address=$1, place_name=$2, detections_to_run=$3 WHERE id=$4 RETURNING *',
      [ip_address, place_name, JSON.stringify(detList), req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ detail: "Camera not found" });
    
    axios.post(`http://127.0.0.1:8001/start/${req.params.id}`, { source: ip_address }).catch(e => {});
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/cameras/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM cameras WHERE id=$1', [req.params.id]);
    axios.post(`http://127.0.0.1:8001/stop/${req.params.id}`).catch(e => {});
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/cameras', authenticateToken, async (req, res) => {
  try {
    const { rows: cameras } = await pool.query('SELECT * FROM cameras ORDER BY id ASC');
    let workerStatusMap = {};
    try {
      const workerRes = await axios.get('http://127.0.0.1:8001/status');
      workerStatusMap = workerRes.data.details || {};
    } catch(e) {}

    const result = cameras.map(cam => {
      const info = workerStatusMap[cam.id] || {};
      return {
        ...cam,
        status: cam.is_active ? (info.status || "Starting...") : "No connection",
        frames: info.frames || 0,
        last_seen: info.last_seen || 0
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/cameras-toggle/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_active, ip_address FROM cameras WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ detail: "Not found" });
    
    const newStatus = !rows[0].is_active;
    await pool.query('UPDATE cameras SET is_active=$1 WHERE id=$2', [newStatus, req.params.id]);
    
    if (newStatus) {
      axios.post(`http://127.0.0.1:8001/start/${req.params.id}`, { source: rows[0].ip_address }).catch(e => {});
    } else {
      axios.post(`http://127.0.0.1:8001/stop/${req.params.id}`).catch(e => {});
    }
    
    res.json({ is_active: newStatus });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.post('/api/cameras-restart/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT ip_address FROM cameras WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ detail: "Not found" });
    
    await axios.post(`http://127.0.0.1:8001/start/${req.params.id}`, { source: rows[0].ip_address });
    res.json({ status: "restarted" });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/stats', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const alertsQuery = await pool.query(`SELECT COUNT(*) FROM alerts WHERE DATE(timestamp) = $1`, [today]);
    const vehiclesQuery = await pool.query(`SELECT COUNT(*) FROM vehicle_checks WHERE DATE(time_in) = $1`, [today]);
    const camerasQuery = await pool.query('SELECT COUNT(*) FROM cameras WHERE is_active = true');
    
    res.json({
      total_alerts: parseInt(alertsQuery.rows[0].count),
      total_vehicles: parseInt(vehiclesQuery.rows[0].count),
      active_cameras: parseInt(camerasQuery.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// Zones
app.post('/api/zones', authenticateToken, async (req, res) => {
  const camera_id = req.query.camera_id;
  const activation_time = req.query.activation_time;
  const points = req.body;
  try {
    const actTime = activation_time ? new Date(activation_time) : null;
    const r = await pool.query(
      'INSERT INTO restriction_zones (camera_id, polygon_points, activation_time, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
      [camera_id, JSON.stringify(points), actTime, true]
    );
    // Trigger AI Worker Reload
    axios.post(`http://127.0.0.1:8001/reload/${camera_id}`).catch(e => {});
    
    res.json({ status: "success", zone_id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/zones/:camera_id', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM restriction_zones WHERE camera_id=$1', [req.params.camera_id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/zones/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT camera_id FROM restriction_zones WHERE id=$1', [req.params.id]);
    const camId = rows.length > 0 ? rows[0].camera_id : null;
    
    await pool.query('DELETE FROM restriction_zones WHERE id=$1', [req.params.id]);
    
    if (camId) {
      axios.post(`http://127.0.0.1:8001/reload/${camId}`).catch(e => {});
    }
    
    res.json({ status: "Zone deleted" });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

// Logs
app.get('/api/alerts', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 30');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/vehicles', authenticateToken, async (req, res) => {
  const { start_date, end_date, search } = req.query;
  try {
    let query = 'SELECT * FROM vehicle_checks WHERE 1=1';
    let params = [];

    if (start_date) {
      params.push(new Date(start_date));
      query += ` AND time_in >= $${params.length}`;
    }
    if (end_date) {
      params.push(new Date(end_date));
      query += ` AND time_in <= $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (plate_number ILIKE $${params.length} OR camera_name ILIKE $${params.length})`;
    }

    query += ' ORDER BY time_in DESC LIMIT 50';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/ppe/stats', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const vTypes = ["helmet", "no_helmet", "person_with_vest", "no_vest"];
    const stats = {};
    for (const vType of vTypes) {
      const q = await pool.query("SELECT COUNT(*) FROM ppe_violations WHERE violation_type=$1 AND DATE(timestamp)=$2", [vType, today]);
      stats[vType] = parseInt(q.rows[0].count);
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

app.get('/api/ppe/logs', authenticateToken, async (req, res) => {
  const { start_date, end_date, search } = req.query;
  try {
    let query = 'SELECT * FROM ppe_violations WHERE 1=1';
    let params = [];

    if (start_date) {
      params.push(new Date(start_date));
      query += ` AND timestamp >= $${params.length}`;
    }
    if (end_date) {
      params.push(new Date(end_date));
      query += ` AND timestamp <= $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (camera_name ILIKE $${params.length} OR violation_type ILIKE $${params.length})`;
    }

    query += ' ORDER BY timestamp DESC LIMIT 100';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Node API Server listening on port ${PORT}`);
  
  // Start active cameras in worker on boot
  try {
    const { rows } = await pool.query('SELECT * FROM cameras WHERE is_active=true');
    console.log(`Found ${rows.length} active cameras to wake up...`);
    for (const cam of rows) {
      setTimeout(() => {
        axios.post(`http://127.0.0.1:8001/start/${cam.id}`, { source: cam.ip_address })
          .then(() => console.log(`Worker started cam ${cam.id}`))
          .catch(e => console.error(`Worker failed to start cam ${cam.id}`));
      }, 5000); // Give worker 5 seconds to boot
    }
  } catch (e) {
    console.error("Boot-up camera query failed", e.message);
  }
});
