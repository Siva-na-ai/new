import React, { useState, useEffect } from 'react'
import { Search, Download, Calendar } from 'lucide-react'

const EntryLogs = () => {
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetch('/api/api-vehicles')
      .then(res => res.json())
      .then(data => setLogs(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  }, []);

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
          <p style={{ color: 'var(--text-dim)' }}>Comprehensive history of all vehicle movements</p>
        </div>
        <button style={{ background: 'var(--glass)', border: '1px solid var(--border)', color: 'white' }}>
          <Download size={18} /> Export CSV
        </button>
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ background: 'var(--glass)', color: 'var(--text-dim)' }}>
            <Calendar size={18} /> Filter Date
          </button>
        </div>
      </div>

      <div className="glass-card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Plate Number</th>
                <th>Detection View</th>
                <th>Camera Location</th>
                <th>Entry Time</th>
                <th>Exit Time</th>
                <th>Status</th>
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
                      <div style={{ width: '120px', height: '60px', background: 'var(--glass)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--text-dim)' }}>
                        NO IMAGE
                      </div>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{log.camera_name || 'N/A'}</td>
                  <td>{log.time_in ? new Date(log.time_in).toLocaleString() : '---'}</td>
                  <td>{log.time_out ? new Date(log.time_out).toLocaleString() : '---'}</td>
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
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
            No logs found matching your search.
          </div>
        )}
      </div>
    </div>
  )
}

export default EntryLogs;
