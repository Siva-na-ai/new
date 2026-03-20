import React, { useState, useEffect } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const Dashboard = () => {
  const [alerts, setAlerts] = useState([]);
  const [vehicleChecks, setVehicleChecks] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });
  const [lastSync, setLastSync] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [stats, setStats] = useState({ total_alerts: 0, total_vehicles: 0, active_cameras: 0 });

  const API_HOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '127.0.0.1:8000' : `${window.location.hostname}:8000`;
  const API_BASE = `${window.location.protocol}//${API_HOST}`;

  const fetchData = () => {
    setIsSyncing(true);
    const start = Date.now();
    
    Promise.all([
      fetch(`${API_BASE}/alerts`).then(res => res.ok ? res.json() : Promise.reject(`Alerts: ${res.status}`)),
      fetch(`${API_BASE}/vehicle-checks`).then(res => res.ok ? res.json() : Promise.reject(`Vehicles: ${res.status}`)),
      fetch(`${API_BASE}/cameras`).then(res => res.ok ? res.json() : Promise.reject(`Cameras: ${res.status}`)),
      fetch(`${API_BASE}/stats`).then(res => res.ok ? res.json() : Promise.reject(`Stats: ${res.status}`))
    ]).then(([alertData, checkData, camData, statData]) => {
      console.log("Dashboard Data Fetched:", { alertData, statData });
      setAlerts(alertData);
      setVehicleChecks(checkData);
      setCameras(camData);
      setStats(statData);
      updateChart(alertData);
      setLastSync(new Date().toLocaleTimeString());
      setIsSyncing(false);
    }).catch(err => {
      console.error("Dashboard Sync Error:", err);
      setIsSyncing(false);
    });
  };

  const updateChart = (alertData) => {
    // Group alerts by hour for the last 6 hours
    const now = new Date();
    const hours = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      hours.push(d.getHours() + ':00');
    }

    // Count alerts per hour (0 if none)
    const counts = hours.map((h) => {
        const hourInt = parseInt(h.split(':')[0]);
        return alertData.filter(a => new Date(a.timestamp).getHours() === hourInt).length; 
    });

    setChartData({
      labels: hours,
      datasets: [
        {
          label: 'System Alerts',
          data: counts,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          tension: 0.4,
          fill: true
        }
      ]
    });
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800 }}>Analytical Dashboard</h2>
          <p style={{ color: 'var(--text-dim)' }}>Real-time intelligence across all surveillance modules</p>
        </div>
        <div className="glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSyncing ? 'var(--primary)' : 'var(--success)', boxShadow: '0 0 10px var(--success)' }}></div>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Sync Status: {lastSync || 'Initializing...'}</span>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Active Cameras</p>
          <h3 style={{ fontSize: '32px', marginTop: '8px' }}>{stats.active_cameras}</h3>
        </div>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center', borderLeft: '4px solid var(--accent)' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Total Alerts</p>
          <h3 style={{ fontSize: '32px', marginTop: '8px', color: 'var(--accent)' }}>{stats.total_alerts}</h3>
        </div>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center', borderLeft: '4px solid var(--primary)' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Vehicle Entries</p>
          <h3 style={{ fontSize: '32px', marginTop: '8px', color: 'var(--primary)' }}>{stats.total_vehicles}</h3>
        </div>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center', borderLeft: '4px solid var(--success)' }}>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>System Health</p>
          <h3 style={{ fontSize: '32px', marginTop: '8px', color: 'var(--success)' }}>98%</h3>
        </div>
      </div>

      <div className="grid-layout">
        <div className="glass-card">
          <h3 style={{ marginBottom: '16px' }}>Detection Trends</h3>
          <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />
        </div>
        
        <div className="glass-card">
          <h3 style={{ marginBottom: '16px' }}>Recent Alerts</h3>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Image</th>
                  <th>Cam</th>
                  <th>Global ID</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => (
                  <tr key={alert.id}>
                    <td>{alert.id}</td>
                    <td><img src={`http://localhost:8000/alerts/${alert.image_path.split('/').pop()}`} width="60" style={{ borderRadius: '4px' }} alt="alert" /></td>
                    <td>{alert.camera_name}</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{alert.global_id}</td>
                    <td>{new Date(alert.timestamp).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="glass-card" style={{ gridColumn: 'span 2' }}>
          <h3 style={{ marginBottom: '16px' }}>Live Vehicle Logs</h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Plate Number</th>
                  <th>Image</th>
                  <th>Camera</th>
                  <th>Time In</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vehicleChecks.slice(0, 10).map(check => (
                  <tr key={check.id}>
                    <td><span style={{ background: '#334155', padding: '4px 8px', borderRadius: '4px', fontStyle: 'monospace', fontWeight: 900 }}>{check.plate_number}</span></td>
                    <td><img src={`http://localhost:8000/plates/${check.plate_image_path.split('/').pop()}`} width="80" style={{ borderRadius: '6px' }} alt="plate" /></td>
                    <td>{check.camera_name}</td>
                    <td>{new Date(check.time_in).toLocaleString()}</td>
                    <td>{check.time_out ? <span style={{ color: 'var(--text-dim)' }}>Departed</span> : <span style={{ color: 'var(--success)' }}>On Premise</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
