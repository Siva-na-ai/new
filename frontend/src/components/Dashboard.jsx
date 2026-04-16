import React, { useState, useEffect } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import { UserCheck, Bell, Video, Truck, ShieldCheck, TrendingUp, Search, Eye, Maximize2, X, Calendar, MapPin, Sun, Moon, Camera } from 'lucide-react'
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
  const [peakInfo, setPeakInfo] = useState({ time: '---', value: 0 });
  const [filter, setFilter] = useState('All');
  
  // New Global Filters
  const [selectedTimeRange, setSelectedTimeRange] = useState(24);
  const [selectedCameraId, setSelectedCameraId] = useState('all');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  const API_BASE = '/api';

  const fetchData = (signal) => {
    setIsSyncing(true);
    const t = Date.now();
    const token = localStorage.getItem('vision_token');
    const headers = { 'Authorization': `Bearer ${token}` };
    
    const queryParams = `?time_range=${selectedTimeRange}&camera_id=${selectedCameraId}&t=${t}`;
    
    Promise.all([
      fetch(`${API_BASE}/alerts${queryParams}`, { headers, signal }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/vehicles${queryParams}`, { headers, signal }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/cameras?t=${t}`, { headers, signal }).then(res => res.ok ? res.json() : []),
      fetch(`${API_BASE}/stats${queryParams}`, { headers, signal }).then(res => res.ok ? res.json() : { total_alerts: 0, total_vehicles: 0, active_cameras: 0 }),
      fetch(`${API_BASE}/ppe/stats${queryParams}`, { headers, signal }).then(res => res.ok ? res.json() : { helmet: 0, no_helmet: 0, vest: 0, no_vest: 0 })
    ]).then(([alertData, checkData, camData, statData, ppeData]) => {
      setAlerts(Array.isArray(alertData) ? alertData : []);
      setVehicleChecks(Array.isArray(checkData) ? checkData : []);
      setCameras(Array.isArray(camData) ? camData : []);
      setStats(statData);
      setPpeStats(ppeData);
      if (Array.isArray(alertData)) updateChart(alertData);
      setLastSync(new Date().toLocaleTimeString());
      setTimeout(() => setIsSyncing(false), 500);
    }).catch(err => {
      if (err.name === 'AbortError') return;
      console.error("Dashboard Sync Error:", err);
      setIsSyncing(false);
      
      // Auto-retry on network failures after 5 seconds
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        console.log("Network glitch detected. Retrying dashboard sync in 5s...");
        setTimeout(() => fetchData(signal), 5000);
      }
    });
  };

   const updateChart = (alertData) => {
    try {
        if (!Array.isArray(alertData)) return;
        
        const intrusionAlerts = alertData.filter(a => !a.is_ppe);
        const now = new Date();
        const intervals = [];
        const counts = [];
        
        // Dynamic interval sizing
        const step = selectedTimeRange <= 6 ? 15 : 30; // 15 min for 6h, 30 min for 12/24h
        const totalSteps = (selectedTimeRange * 60) / step;
        
        for (let i = totalSteps; i >= 0; i--) {
          const d = new Date(now.getTime() - i * step * 60 * 1000);
          const timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
          intervals.push(timeStr);
          
          const count = intrusionAlerts.filter(a => {
            if (!a || !a.timestamp) return false;
            const ad = new Date(a.timestamp);
            const diff = (now.getTime() - ad.getTime()) / (1000 * 60);
            
            // Check if alert falls within this specific interval window
            const windowStart = i * step;
            const windowEnd = (i - 1) * step;
            return diff <= windowStart && diff > windowEnd;
          }).length;
          counts.push(count);
        }

        const maxVal = Math.max(...counts, 0);
        const peakIdx = counts.lastIndexOf(maxVal); // last occurrence is more recent
        const peakTime = maxVal > 0 ? intervals[peakIdx] : '---';
        
        setPeakInfo({ time: peakTime, value: maxVal });

        setChartData({
          labels: intervals,
          datasets: [
            {
              label: 'Intrusion Alerts',
              data: counts,
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              tension: 0.4,
              fill: true,
              pointBackgroundColor: '#fff',
              pointBorderColor: '#6366f1',
              pointBorderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              zIndex: 2
            },
            {
              label: 'Peak Indicator',
              data: Array(intervals.length).fill(maxVal > 0 ? maxVal : null),
              borderColor: 'rgba(244, 63, 94, 0.3)',
              borderDash: [5, 5],
              borderWidth: 1,
              fill: false,
              pointRadius: 0,
              zIndex: 1
            }
          ]
        });
    } catch (e) {
        console.error("Chart Update Error:", e);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    
    const socket = io();
    socket.on('new_alert', (newAlert) => {
       fetchData(controller.signal); 
    });
    socket.on('new_vehicle', (newVehicle) => {
       fetchData(controller.signal);
    });
    
    const interval = setInterval(() => fetchData(controller.signal), 60000);
    
    return () => {
       controller.abort();
       socket.disconnect();
       clearInterval(interval);
    };
  }, [selectedTimeRange, selectedCameraId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', width: '100%', padding: '0' }}>
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        width: '100%',
        paddingBottom: '16px',
        borderBottom: '1px solid var(--border)' 
      }}>
        {/* Left: Title Area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <h2 style={{ 
            fontSize: '26px', 
            fontWeight: 800, 
            letterSpacing: '-0.5px', 
            color: 'var(--text-main)', 
            margin: 0 
          }}>Analytical Dashboard</h2>

          {/* Middle: Integrated Filter Buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            {/* Time Filter - Click to Cycle */}
            <button 
              onClick={() => {
                const nextRange = selectedTimeRange === 24 ? 6 : selectedTimeRange === 6 ? 12 : 24;
                setSelectedTimeRange(nextRange);
              }}
              style={{ 
                padding: '6px 12px', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: '10px', 
                fontSize: '12px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, 
                cursor: 'pointer', transition: 'all 0.2s' 
              }} 
              className="btn-hover-scale"
              title="Click to cycle time range"
            >
               <Calendar size={16} /> Last {selectedTimeRange} Hours
            </button>

            {/* Camera Filter - Click to Cycle */}
            <button 
              onClick={() => {
                const activeCams = cameras.filter(c => c.is_active);
                if (activeCams.length === 0) return;
                
                if (selectedCameraId === 'all') {
                  setSelectedCameraId(activeCams[0].id.toString());
                } else {
                  const currentIndex = activeCams.findIndex(c => c.id.toString() === selectedCameraId);
                  if (currentIndex === -1 || currentIndex === activeCams.length - 1) {
                    setSelectedCameraId('all');
                  } else {
                    setSelectedCameraId(activeCams[currentIndex + 1].id.toString());
                  }
                }
              }}
              style={{ 
                padding: '6px 12px', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: '10px', 
                fontSize: '12px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, 
                cursor: 'pointer', transition: 'all 0.2s' 
              }} 
              className="btn-hover-scale"
              title="Click to cycle cameras"
            >
               <Camera size={16} /> 
               {selectedCameraId === 'all' ? `All Cameras (${cameras.length})` : cameras.find(c => c.id.toString() === selectedCameraId)?.place_name || 'Selected Cam'}
            </button>
          </div>
        </div>

           {/* Right: User & Status Controls */}
           <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>

           {/* Utility Icons */}
           <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: 'var(--text-dim)' }}>
              <div style={{ position: 'relative', cursor: 'pointer' }} className="btn-hover-scale">
                <Bell size={20} />
                <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg-dark)' }} />
              </div>
               <div 
                 style={{ cursor: 'pointer' }} 
                 className="btn-hover-scale"
                 onClick={() => {
                   const isLight = document.documentElement.classList.toggle('light-theme');
                   const newTheme = isLight ? 'light' : 'dark';
                   localStorage.setItem('theme', newTheme);
                   setTheme(newTheme);
                 }}
               >
                 {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
               </div>
           </div>

           {/* User Profile */}
           <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingLeft: '24px', borderLeft: '1px solid var(--border)' }}>
              <div style={{ textAlign: 'right' }}>
                 <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--text-main)' }}>{localStorage.getItem('vision_user') || 'System Admin'}</p>
                 <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Administrator</p>
              </div>
              <div style={{ 
                width: '42px', height: '42px', borderRadius: '14px', 
                background: 'linear-gradient(135deg, var(--primary), #4338ca)', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                fontWeight: 900, color: 'white', fontSize: '16px', 
                boxShadow: '0 4px 15px rgba(99,102,241,0.25)' 
              }}>
                {(localStorage.getItem('vision_user') || 'SA').substring(0, 2).toUpperCase()}
              </div>
           </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px' }}>
        {/* Card 1: Restriction Alerts */}
        <div className="glass-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden', transition: 'transform 0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Restriction Alerts</p>
              <h3 style={{ fontSize: '38px', fontWeight: 800, marginTop: '12px', letterSpacing: '-1px' }}>{stats.total_alerts}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', color: 'var(--accent)', fontSize: '12px', fontWeight: 800 }}>
                 <TrendingUp size={14} /> +4 <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>last hour</span>
              </div>
            </div>
            <div style={{ padding: '14px', borderRadius: '18px', background: 'rgba(244,63,94,0.12)', color: 'var(--accent)', border: '1px solid rgba(244,63,94,0.1)' }}>
              <Bell size={24} />
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.5 }} />
        </div>

        {/* Card 2: Active Cameras */}
        <div className="glass-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Cameras</p>
              <h3 style={{ fontSize: '38px', fontWeight: 800, marginTop: '12px', letterSpacing: '-1px' }}>{stats.active_cameras}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', color: 'var(--primary)', fontSize: '12px', fontWeight: 800 }}>
                 <Video size={14} /> System Healthy
              </div>
            </div>
            <div style={{ padding: '14px', borderRadius: '18px', background: 'rgba(99,102,241,0.12)', color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.1)' }}>
              <Video size={24} />
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.5 }} />
        </div>

        {/* Card 3: Vehicle Entries */}
        <div className="glass-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vehicle Entries</p>
              <h3 style={{ fontSize: '38px', fontWeight: 800, marginTop: '12px', letterSpacing: '-1px' }}>{stats.total_vehicles}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', color: 'var(--success)', fontSize: '12px', fontWeight: 800 }}>
                 <TrendingUp size={14} /> -3% <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>vs yesterday</span>
              </div>
            </div>
            <div style={{ padding: '14px', borderRadius: '18px', background: 'rgba(79,70,229,0.12)', color: '#6366f1', border: '1px solid rgba(79,70,229,0.1)' }}>
              <Truck size={24} />
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, transparent, #6366f1, transparent)', opacity: 0.5 }} />
        </div>

        {/* Card 4: PPE Compliance */}
        <div className="glass-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PPE Compliance</p>
              <h3 style={{ fontSize: '38px', fontWeight: 800, marginTop: '12px', letterSpacing: '-1px' }}>{stats.total_vehicles > 0 ? '94%' : '0%'}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', color: 'var(--success)', fontSize: '12px', fontWeight: 800 }}>
                 <TrendingUp size={14} /> +2% <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>vs last week</span>
              </div>
            </div>
            <div style={{ padding: '14px', borderRadius: '18px', background: 'rgba(6,182,212,0.12)', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.1)' }}>
              <ShieldCheck size={24} />
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)', opacity: 0.5 }} />
        </div>
      </div>

      <div className="glass-card" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
           <div>
              <h3 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>Detection Trends</h3>
              <p style={{ color: 'var(--text-dim)', fontSize: '14px', fontWeight: 600, marginTop: '4px' }}>Violations over the last {selectedTimeRange} hours</p>
           </div>
           <div style={{ padding: '8px 20px', borderRadius: '24px', background: 'rgba(244,63,94,0.08)', color: 'var(--accent)', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid rgba(244,63,94,0.1)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} /> Peak at {peakInfo.time}
           </div>
        </div>
        <div style={{ height: '380px' }}>
          <Line 
            data={chartData} 
            options={{ 
              responsive: true, 
              maintainAspectRatio: false,
              plugins: { 
                legend: { display: false }, 
                tooltip: { 
                  backgroundColor: '#1e293b', 
                  titleColor: '#fff', 
                  bodyColor: '#fff', 
                  padding: 12, 
                  cornerRadius: 10,
                  callbacks: {
                    label: (context) => context.dataset.label === 'Peak Indicator' ? null : `${context.parsed.y} violations`
                  }
                } 
              },
              scales: {
                y: { 
                  display: true,
                  title: { display: true, text: 'Violations', color: theme === 'light' ? '#0f172a' : '#ffffff', font: { weight: '800', size: 12 } },
                  grid: { display: false }, 
                  border: { display: true, color: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)' },
                  ticks: { display: true, color: theme === 'light' ? '#0f172a' : '#ffffff', font: { weight: '700', size: 12 } } 
                },
                x: { 
                  display: true,
                  grid: { display: false }, 
                  border: { display: true, color: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)' },
                  ticks: { display: true, color: theme === 'light' ? '#0f172a' : '#ffffff', font: { weight: '700', size: 11 }, maxRotation: 45, minRotation: 45 } 
                }
              }
            }} 
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '32px' }}>
        <div className="glass-card" style={{ padding: '28px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-main)' }}>Recent Alerts</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
               {['All', 'No Helmet', 'No Vest', 'Intrusion'].map((btn, i) => (
                  <button 
                    key={i} 
                    onClick={() => setFilter(btn)}
                    style={{ 
                      padding: '6px 16px', 
                      fontSize: '12px', 
                      fontWeight: 700, 
                      background: filter === btn ? 'var(--primary)' : 'var(--glass)', 
                      color: filter === btn ? 'white' : 'var(--text-main)', 
                      borderRadius: '10px', 
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {btn}
                  </button>
               ))}
            </div>
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto', borderRadius: '12px' }}>
            <table className="modern-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>PREVIEW</th>
                  <th>CAMERA</th>
                  <th>TYPE</th>
                  <th>SEVERITY</th>
                  <th>TIME</th>
                  <th style={{ width: '120px' }}>STATUS</th>
                  <th style={{ width: '120px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(alerts) && 
                  alerts
                  .filter(alert => {
                    if (filter === 'All') return true;
                    if (filter === 'No Helmet') return alert.class_name === 'no_helmet';
                    if (filter === 'No Vest') return alert.class_name === 'no_vest';
                    if (filter === 'Intrusion') return !['helmet', 'no_helmet', 'vest', 'no_vest'].includes(alert.class_name);
                    return true;
                  })
                  .map(alert => {
                    const isNoHelmet = alert.class_name === 'no_helmet';
                    const isNoVest = alert.class_name === 'no_vest';
                    const severityLabel = isNoHelmet ? 'MEDIUM' : (isNoVest ? 'LOW' : 'HIGH');
                    const severityColor = isNoHelmet ? '#f59e0b' : (isNoVest ? '#3b82f6' : 'var(--accent)');
                    const severityBg = isNoHelmet ? 'rgba(245,158,11,0.08)' : (isNoVest ? 'rgba(59,130,246,0.08)' : 'rgba(244,63,94,0.08)');

                    return (
                      <tr key={`${alert.is_ppe ? 'p' : 'a'}-${alert.id}`}>
                        <td style={{ fontWeight: 800, opacity: 0.9, fontSize: '12px', color: 'var(--text-main)' }}>
                          #{alert.is_ppe ? `P${alert.id}` : alert.id}
                        </td>
                        <td>
                          {alert.image_data ? (
                            <div onClick={() => {setSelectedItem(alert); setModalType('alert');}} style={{ width: '70px', height: '44px', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', border: '2px solid var(--border)', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                              <img src={`data:image/jpeg;base64,${alert.image_data}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="alert" />
                            </div>
                          ) : (
                            <div style={{ width: '70px', height: '44px', background: 'var(--bg-dark)', borderRadius: '10px' }} />
                          )}
                        </td>
                        <td style={{ fontWeight: 800, color: 'var(--text-main)' }}>{alert.camera_name}</td>
                        <td>
                          <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '10px', background: 'rgba(99,102,241,0.08)', color: 'var(--primary)', fontWeight: 900, textTransform: 'uppercase' }}>
                            {alert.class_name?.replace('_', ' ') || 'Restriction'}
                          </span>
                        </td>
                        <td>
                          <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '10px', background: severityBg, color: severityColor, fontWeight: 900, textTransform: 'uppercase' }}>
                            {severityLabel}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-dim)', fontSize: '13px', fontWeight: 600 }}>{alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}</td>
                        <td>
                          <span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '10px', background: 'rgba(16,185,129,0.08)', color: 'var(--success)', fontWeight: 900, textTransform: 'uppercase' }}>Active</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            onClick={() => {setSelectedItem(alert); setModalType('alert');}} 
                            style={{ 
                              padding: '6px 14px', 
                              borderRadius: '8px', 
                              background: 'var(--primary)', 
                              color: 'white', 
                              fontSize: '11px', 
                              fontWeight: 800, 
                              border: 'none', 
                              cursor: 'pointer',
                              boxShadow: '0 4px 12px rgba(99,102,241,0.2)'
                            }}
                          >
                            VIEW
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(12px)', animation: 'fadeIn 0.3s ease' }}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '95%', maxWidth: '750px', maxHeight: '95vh', overflowY: 'auto', padding: '40px', position: 'relative', border: '1px solid var(--border)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)', background: 'var(--bg-card)', borderRadius: '32px' }}>
            <button 
              onClick={() => setSelectedItem(null)}
              style={{ 
                position: 'absolute', 
                top: '24px', 
                right: '24px', 
                zIndex: 100, 
                background: 'rgba(244, 63, 94, 0.12)', 
                border: '1.5px solid rgba(244, 63, 94, 0.3)', 
                color: '#f43f5e', 
                width: '40px', 
                height: '40px', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer', 
                transition: 'all 0.2s',
                padding: '0'
              }}
              onMouseOver={e => {
                e.currentTarget.style.transform = 'scale(1.1)';
                e.currentTarget.style.background = 'rgba(244, 63, 94, 0.2)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = 'rgba(244, 63, 94, 0.12)';
              }}
              title="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <h3 style={{ marginBottom: '32px', fontSize: '26px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
              {modalType === 'alert' ? 'Security Alert Insight' : 'Transport Activity Detail'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {selectedItem.image_data ? (
                <div style={{ width: '100%', maxHeight: '55vh', overflow: 'hidden', borderRadius: '24px', border: '2px solid var(--border)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', background: '#000' }}>
                  <img 
                    src={`data:image/jpeg;base64,${selectedItem.image_data}`} 
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} 
                    alt="detail"
                  />
                </div>
              ) : (
                <div style={{ width: '100%', height: '350px', background: 'rgba(255,255,255,0.02)', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '14px', border: '1px dashed rgba(255,255,255,0.1)' }}>
                  No Visual Evidence Available
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px', background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div>
                   <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800, letterSpacing: '1px' }}>System Node</label>
                   <p style={{ fontWeight: 800, fontSize: '16px' }}>{selectedItem.camera_name || 'N/A'}</p>
                </div>
                <div>
                   <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800, letterSpacing: '1px' }}>Verified At</label>
                   <p style={{ fontWeight: 800, fontSize: '16px' }}>{new Date(selectedItem.timestamp || selectedItem.time_in).toLocaleString()}</p>
                </div>
                {modalType === 'alert' && (
                  <div style={{ gridColumn: 'span 2' }}>
                     <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800, letterSpacing: '1px' }}>Global Tracking Reference</label>
                     <p style={{ fontWeight: 900, fontSize: '20px', color: 'var(--primary)' }}>ID #{selectedItem.is_ppe ? `P${selectedItem.id}` : (selectedItem.global_id || 'LOCAL_TRACK_ONLY')}</p>
                  </div>
                )}
                {modalType === 'vehicle' && (
                  <>
                    <div>
                       <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', fontWeight: 800, letterSpacing: '1px' }}>Transport ID</label>
                       <p style={{ fontWeight: 900, fontSize: '22px', color: 'var(--success)', letterSpacing: '1px' }}>{selectedItem.plate_number || 'UNKNOWN'}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
;
