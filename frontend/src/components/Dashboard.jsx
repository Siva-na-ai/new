import React, { useState, useEffect } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import { UserCheck } from 'lucide-react'
import { io } from 'socket.io-client';
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
  const [ppeStats, setPpeStats] = useState({ helmet: 0, no_helmet: 0, vest: 0, no_vest: 0 });
  const [selectedItem, setSelectedItem] = useState(null);
  const [modalType, setModalType] = useState(null);

  const API_BASE = '/api';

  const fetchData = () => {
    setIsSyncing(true);
    const t = Date.now(); // Cache-busting timestamp
    const token = localStorage.getItem('vision_token');
    const headers = { 'Authorization': `Bearer ${token}` };
    
    Promise.all([
      fetch(`${API_BASE}/alerts?t=${t}`, { headers }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/vehicles?t=${t}`, { headers }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/cameras?t=${t}`, { headers }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/stats?t=${t}`, { headers }).then(res => res.ok ? res.json() : { total_alerts: 0, total_vehicles: 0, active_cameras: 0 }),
      fetch(`${API_BASE}/ppe/stats?t=${t}`, { headers }).then(res => res.ok ? res.json() : { helmet: 0, no_helmet: 0, vest: 0, no_vest: 0 })
    ]).then(([alertData, checkData, camData, statData, ppeData]) => {
      setAlerts(Array.isArray(alertData) ? alertData : []);
      setVehicleChecks(Array.isArray(checkData) ? checkData : []);
      setCameras(Array.isArray(camData) ? camData : []);
      setStats(statData);
      setPpeStats(ppeData);
      if (Array.isArray(alertData)) updateChart(alertData);
      setLastSync(new Date().toLocaleTimeString());
      setTimeout(() => setIsSyncing(false), 500); // Visual delay for feedback
    }).catch(err => {
      console.error("Dashboard Sync Error:", err);
      setIsSyncing(false);
    });
  };

  const updateChart = (alertData) => {
    try {
        if (!Array.isArray(alertData)) return;
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
            return alertData.filter(a => a && a.timestamp && new Date(a.timestamp).getHours() === hourInt).length; 
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
    } catch (e) {
        console.error("Chart Update Error:", e);
    }
  };

  useEffect(() => {
    fetchData(); // Initial load

    const socket = io();
    
    socket.on('new_alert', (newAlert) => {
       setAlerts(prev => {
          const updated = [newAlert, ...prev].slice(0, 30);
          updateChart(updated);
          return updated;
       });
       setStats(prev => ({ ...prev, total_alerts: prev.total_alerts + 1 }));
       
       // Update PPE stats if applicable
       if (['helmet', 'no_helmet', 'vest', 'no_vest'].includes(newAlert.class_name)) {
          setPpeStats(prev => {
            const copy = { ...prev };
            const cls = newAlert.class_name;
            if (copy[cls] !== undefined) copy[cls] += 1;
            return copy;
          });
       }
    });

    socket.on('new_vehicle', (newVehicle) => {
       setVehicleChecks(prev => [newVehicle, ...prev].slice(0, 10));
       setStats(prev => ({ ...prev, total_vehicles: prev.total_vehicles + 1 }));
    });

    // We can still softly refresh overall camera statuses every 60 seconds
    const interval = setInterval(() => {
       fetch(`${API_BASE}/cameras`).then(res => res.ok ? res.json() : []).then(cams => {
           if (Array.isArray(cams)) setCameras(cams);
       });
    }, 60000);

    return () => {
       socket.disconnect();
       clearInterval(interval);
    };
  }, []);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800 }}>Analytical Dashboard</h2>
          <p style={{ color: 'var(--text-dim)', fontWeight: 700 }}>Real-time intelligence across all surveillance modules</p>
        </div>
        <div className="glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.05)', minWidth: '220px' }}>
          <div className={isSyncing ? "pulse-blue" : "pulse-green"} style={{ 
            width: '8px', height: '8px', borderRadius: '50%', 
            background: isSyncing ? 'var(--primary)' : 'var(--success)', 
            boxShadow: `0 0 10px ${isSyncing ? 'var(--primary)' : 'var(--success)'}` 
          }}></div>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{isSyncing ? 'Syncing...' : `Last Sync: ${lastSync || '---'}`}</span>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-main)', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>Active Cameras</p>
          <h3 style={{ fontSize: '28px', marginTop: '8px' }}>{stats.active_cameras}</h3>
        </div>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-main)', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>Restriction Alerts</p>
          <h3 style={{ fontSize: '28px', marginTop: '8px', color: 'var(--accent)' }}>{stats.total_alerts}</h3>
        </div>
        <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-main)', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>Vehicle Entries</p>
          <h3 style={{ fontSize: '28px', marginTop: '8px', color: 'var(--primary)' }}>{stats.total_vehicles}</h3>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '24px' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <UserCheck color="var(--primary)" size={24} />
            <h4 style={{ fontSize: '18px', fontWeight: 800 }}>PPE Monitoring (Today)</h4>
         </div>
         
         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px' }}>
               <p style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 900, opacity: 0.9 }}>NO HELMET</p>
               <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: '#ef4444' }}>{ppeStats.no_helmet}</div>
            </div>
             <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 900, opacity: 0.9 }}>NO VEST</p>
                <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', color: '#f97316' }}>{ppeStats.no_vest}</div>
             </div>
         </div>
      </div>

      <div className="dashboard-grid">
        <div className="glass-card">
          <h3 style={{ marginBottom: '16px', fontWeight: 800 }}>Detection Trends</h3>
          <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />
        </div>
        
        <div className="glass-card">
          <h3 style={{ marginBottom: '16px', fontWeight: 800 }}>Recent Alerts</h3>
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
                {Array.isArray(alerts) && alerts.map(alert => (
                  <tr key={alert.id}>
                    <td>{alert.id}</td>
                    <td>
                      {alert.image_data ? (
                        <img src={`data:image/jpeg;base64,${alert.image_data}`} width="60" style={{ borderRadius: '4px', cursor: 'pointer' }} alt="alert" onClick={() => {setSelectedItem(alert); setModalType('alert');}} />
                      ) : (
                        <div style={{ width: '60px', height: '40px', background: '#334155', borderRadius: '4px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Img</div>
                      )}
                    </td>
                    <td>{alert.camera_name}</td>
                    <td style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{alert.global_id}</td>
                    <td>{alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'N/A'}</td>
                    <td>
                      <button 
                        onClick={() => {setSelectedItem(alert); setModalType('alert');}}
                        style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--primary-glow)', border: '1px solid var(--primary)' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="glass-card wide-card">
          <h3 style={{ marginBottom: '16px', fontWeight: 800 }}>Live Vehicle Logs</h3>
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
                {Array.isArray(vehicleChecks) && vehicleChecks.slice(0, 10).map(check => (
                  <tr key={check.id}>
                    <td><span style={{ background: '#334155', padding: '4px 8px', borderRadius: '4px', fontStyle: 'monospace', fontWeight: 900 }}>{check.plate_number}</span></td>
                    <td>
                      {check.image_data ? (
                        <img src={`data:image/jpeg;base64,${check.image_data}`} width="80" style={{ borderRadius: '6px', cursor: 'pointer' }} alt="plate" onClick={() => {setSelectedItem(check); setModalType('vehicle');}} />
                      ) : (
                        <div style={{ width: '80px', height: '50px', background: '#334155', borderRadius: '6px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Img</div>
                      )}
                    </td>
                    <td>{check.camera_name}</td>
                    <td>{check.time_in ? new Date(check.time_in).toLocaleString() : 'N/A'}</td>
                    <td>{check.time_out ? <span style={{ color: 'var(--text-dim)' }}>Departed</span> : <span style={{ color: 'var(--success)' }}>On Premise</span>}</td>
                    <td>
                      <button 
                        onClick={() => {setSelectedItem(check); setModalType('vehicle');}}
                        style={{ padding: '4px 10px', fontSize: '12px', background: 'var(--primary-glow)', border: '1px solid var(--primary)' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '90%', maxWidth: '600px', padding: '32px', position: 'relative' }}>
            <button 
              onClick={() => setSelectedItem(null)}
              style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}
            >
              ×
            </button>
            
            <h3 style={{ marginBottom: '24px', fontSize: '22px' }}>
              {modalType === 'alert' ? 'Security Alert Detail' : 'Vehicle Log Detail'}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {selectedItem.image_data ? (
                <img 
                  src={`data:image/jpeg;base64,${selectedItem.image_data}`} 
                  style={{ width: '100%', borderRadius: '16px', border: '1px solid var(--glass-border)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} 
                  alt="detail"
                />
              ) : (
                <div style={{ width: '100%', height: '300px', background: 'var(--glass)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
                  No Image Available
                </div>
              )}
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px' }}>
                <div>
                  <label style={{ display: 'block', color: 'var(--text-main)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800, opacity: 0.8 }}>Camera Source</label>
                  <p style={{ fontWeight: 600 }}>{selectedItem.camera_name || 'N/A'}</p>
                </div>
                <div>
                  <label style={{ display: 'block', color: 'var(--text-main)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800, opacity: 0.8 }}>Detection Time</label>
                  <p style={{ fontWeight: 600 }}>{new Date(selectedItem.timestamp || selectedItem.time_in).toLocaleString()}</p>
                </div>
                {modalType === 'alert' && (
                  <div>
                    <label style={{ display: 'block', color: 'var(--text-main)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800, opacity: 0.8 }}>Global ID</label>
                    <p style={{ fontWeight: 600, color: 'var(--primary)' }}>{selectedItem.global_id || 'untracked'}</p>
                  </div>
                )}
                {modalType === 'vehicle' && (
                  <>
                    <div>
                      <label style={{ display: 'block', color: 'var(--text-main)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800, opacity: 0.8 }}>Plate Number</label>
                      <p style={{ fontWeight: 900, fontSize: '18px', color: 'var(--success)' }}>{selectedItem.plate_number || 'N/A'}</p>
                    </div>
                    {selectedItem.time_out && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', color: 'var(--text-main)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px', fontWeight: 800, opacity: 0.8 }}>Departure Time</label>
                        <p style={{ fontWeight: 600 }}>{new Date(selectedItem.time_out).toLocaleString()}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            
            <button 
              onClick={() => setSelectedItem(null)}
              style={{ marginTop: '24px', width: '100%', height: '48px', background: 'var(--glass)', border: '1px solid var(--glass-border)' }}
            >
              Close Record
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
