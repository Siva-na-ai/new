import React, { useState, useEffect } from 'react'
import { Search, Download, Calendar } from 'lucide-react'

const EntryLogs = () => {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchLogs = () => {
    setIsSyncing(true);
    const t = Date.now();
    const token = localStorage.getItem('vision_token');
    let url = `/api/vehicles?t=${t}`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;
    if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setLogs(Array.isArray(data) ? data : []);
        setLastSync(new Date().toLocaleTimeString());
        setTimeout(() => setIsSyncing(false), 500);
      })
      .catch(err => {
        console.error(err);
        setIsSyncing(false);
      });
  };

  useEffect(() => {
    fetchLogs();
    
    import('socket.io-client').then(({ io }) => {
       const socket = io();
       socket.on('new_vehicle', () => {
          fetchLogs();
       });
       return () => socket.disconnect();
    });
  }, [startDate, endDate, searchTerm]);

  const filteredLogs = logs.filter(log => {
    const plate = (log.plate_number || "").toLowerCase();
    const camera = (log.camera_name || "").toLowerCase();
    const search = searchTerm.toLowerCase();
    return plate.includes(search) || camera.includes(search);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800 }}>Entry Logs</h2>
          <p className="mega-bold-white">Comprehensive history of all vehicle movements</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', fontSize: '11px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSyncing ? 'var(--primary)' : 'var(--success)', boxShadow: `0 0 10px ${isSyncing ? 'var(--primary)' : 'var(--success)'}` }}></div>
            <span style={{ fontWeight: 600 }}>{isSyncing ? 'Syncing...' : `Last Sync: ${lastSync || '---'}`}</span>
          </div>
          <button style={{ background: 'var(--glass)', border: '1px solid var(--border)', color: 'white' }}>
            <Download size={18} /> Export CSV
          </button>
        </div>
      </header>

      <div className="glass-card" style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={20} style={{ position: 'absolute', left: '16px', top: '14px', color: 'var(--text-dim)' }} />
          <input 
            type="text" 
            placeholder="Search by Plate Number or Camera..." 
            style={{ paddingLeft: '48px', marginBottom: 0 }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 800 }}>START DATE</label>
            <input 
              type="datetime-local" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: '180px', padding: '6px 10px', marginBottom: 0, fontSize: '13px' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 800 }}>END DATE</label>
            <input 
              type="datetime-local" 
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: '180px', padding: '6px 10px', marginBottom: 0, fontSize: '13px' }}
            />
          </div>
        </div>
      </div>

      <div className="glass-card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ fontWeight: 800 }}>Plate Number</th>
                <th style={{ fontWeight: 800 }}>Detection View</th>
                <th style={{ fontWeight: 800 }}>Camera Location</th>
                <th style={{ fontWeight: 800 }}>Entry Time</th>
                <th style={{ fontWeight: 800 }}>Exit Time</th>
                <th style={{ fontWeight: 800 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => (
                <tr key={log.id}>
                  <td>
                    <span style={{ 
                      background: '#1e293b', 
                      color: 'white',
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontFamily: 'monospace', 
                      fontWeight: 900,
                      border: '2px solid #334155',
                      fontSize: '16px'
                    }}>
                      {log.plate_number || 'UNKNOWN'}
                    </span>
                  </td>
                  <td>
                    {log.image_data ? (
                      <img 
                        src={`data:image/jpeg;base64,${log.image_data}`} 
                        width="120" 
                        style={{ borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--border)' }}
                        alt="plate" 
                        onClick={() => {
                          const win = window.open();
                          win.document.write(`<img src="data:image/jpeg;base64,${log.image_data}" style="max-width:100%"/>`);
                        }}
                      />
                    ) : (
                      <div className="mega-bold-white" style={{ width: '120px', height: '60px', background: 'var(--glass)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                        NO IMAGE
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{log.camera_name || 'N/A'}</td>
                  <td style={{ fontWeight: 700 }}>{log.time_in ? new Date(log.time_in).toLocaleString() : '---'}</td>
                  <td style={{ fontWeight: 700 }}>{log.time_out ? new Date(log.time_out).toLocaleString() : '---'}</td>
                  <td>
                    <span style={{ 
                      padding: '4px 10px', 
                      borderRadius: '6px', 
                      fontSize: '12px',
                      fontWeight: 700,
                      background: log.time_out ? 'rgba(148,163,184,0.1)' : 'rgba(16,185,129,0.1)',
                      color: log.time_out ? 'var(--text-dim)' : 'var(--success)',
                      border: `1px solid ${log.time_out ? 'rgba(148,163,184,0.2)' : 'rgba(16,185,129,0.2)'}`
                    }}>
                      {log.time_out ? 'COMPLETED' : 'IN PROGRESS'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredLogs.length === 0 && (
          <div className="mega-bold-white" style={{ textAlign: 'center', padding: '40px' }}>
            No logs found matching your search.
          </div>
        )}
      </div>
    </div>
  )
}

export default EntryLogs;
