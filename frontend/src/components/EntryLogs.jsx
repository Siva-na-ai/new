import React, { useState, useEffect, useRef } from 'react'
import { Search, Download, Filter, Trash2, ChevronDown } from 'lucide-react'
import { useNotification } from '../context/NotificationContext'

const EntryLogs = () => {
  const { showNotification } = useNotification();
  const [logs, setLogs] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
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
    
    let socket;
    import('socket.io-client').then(({ io }) => {
       socket = io();
       socket.on('new_vehicle', () => {
          fetchLogs();
       });
    });

    return () => socket && socket.disconnect();
  }, []); // Only fetch on mount and socket events

  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const handleExport = () => {
    const token = localStorage.getItem('vision_token');
    let url = `/api/vehicles/export?`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;
    
    window.location.href = url + `&token=${token}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em' }}>Entry Logs</h2>
          <p style={{ color: 'var(--text-dim)', fontWeight: 600, fontSize: '14px', marginTop: '4px' }}>Comprehensive history of all vehicle movements</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSyncing ? 'var(--primary)' : 'var(--success)', boxShadow: `0 0 12px ${isSyncing ? 'var(--primary--glow)' : 'rgba(16,185,129,0.3)'}` }}></div>
            <span style={{ fontWeight: 800, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>{isSyncing ? 'Syncing...' : `Last Sync: ${lastSync || '---'}`}</span>
          </div>
          
          <div style={{ position: 'relative' }}>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              style={{ 
                background: showFilters ? 'var(--primary)' : 'var(--glass)', 
                color: showFilters ? 'white' : 'var(--text-main)',
                border: showFilters ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                padding: '10px 24px',
                borderRadius: '14px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'all 0.2s',
                cursor: 'pointer'
              }}
            >
              <Filter size={18} /> 
              <span>Filters</span>
              {(startDate || endDate) && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />}
              <ChevronDown size={14} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {showFilters && (
              <>
                <div 
                  onClick={() => setShowFilters(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
                />
                <div 
                  className="glass-card" 
                  style={{ 
                    position: 'absolute', 
                    top: 'calc(100% + 12px)', 
                    right: 0, 
                    zIndex: 1001, 
                    width: '280px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    boxShadow: '0 30px 60px rgba(0, 0, 0, 0.5)',
                    border: '1.5px solid var(--border)',
                    animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    background: 'var(--bg-card)',
                    borderRadius: '20px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>Filter Results</h4>
                    <button 
                      onClick={() => { setStartDate(''); setEndDate(''); fetchLogs(); setShowFilters(false); showNotification('Filters cleared successfully.', 'success'); }} 
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '11px', fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase' }}
                    >
                      RESET
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase' }}>Start Date & Time</label>
                    <input 
                      type="datetime-local" 
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="light-date-input"
                      style={{ 
                        padding: '8px 12px', 
                        fontSize: '14px', 
                        borderRadius: '10px', 
                        background: '#ffffff', 
                        color: '#000000', 
                        border: '2px solid transparent',
                        fontWeight: 600,
                        width: '100%'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase' }}>End Date & Time</label>
                    <input 
                      type="datetime-local" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="light-date-input"
                      style={{ 
                        padding: '8px 12px', 
                        fontSize: '14px', 
                        borderRadius: '10px', 
                        background: '#ffffff', 
                        color: '#000000', 
                        border: '2px solid transparent',
                        fontWeight: 600,
                        width: '100%'
                      }}
                    />
                  </div>
                  
                  <button 
                    onClick={() => { fetchLogs(); setShowFilters(false); showNotification('Log filters applied successfully.', 'success'); }}
                    className="btn-primary"
                    style={{ width: '100%', padding: '12px', borderRadius: '12px', fontWeight: 800, marginTop: '4px' }}
                  >
                    Apply Filters
                  </button>
                </div>
              </>
            )}
          </div>

          <button 
            onClick={handleExport}
            style={{ 
              background: 'var(--primary)', 
              color: 'white',
              padding: '10px 24px',
              fontWeight: 800,
              borderRadius: '14px',
              boxShadow: '0 10px 25px var(--primary-glow)',
              border: '1.5px solid rgba(255,255,255,0.1)'
            }}
          >
            <Download size={18} /> Export CSV
          </button>
        </div>
      </header>

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
              {logs.map(log => (
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
                        onClick={() => setSelectedPhoto(log.image_data)}
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
        {logs.length === 0 && (
          <div className="mega-bold-white" style={{ textAlign: 'center', padding: '40px', opacity: 0.5 }}>
            No logs found for the selected criteria.
          </div>
        )}
      </div>

      {selectedPhoto && (
        <div className="modal-overlay" onClick={() => setSelectedPhoto(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(12px)', animation: 'fadeIn 0.3s ease' }}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '95%', maxWidth: '900px', maxHeight: '90vh', padding: '16px', position: 'relative', border: '1px solid var(--border)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', overflow: 'hidden', borderRadius: '32px' }}>
            <button 
              onClick={() => setSelectedPhoto(null)}
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
            <div style={{ width: '100%', height: 'auto', maxHeight: 'calc(90vh - 32px)', overflow: 'hidden', borderRadius: '20px', background: '#000' }}>
              <img src={`data:image/jpeg;base64,${selectedPhoto}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="Plate Detail" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EntryLogs;
