import React, { useState, useEffect, useRef } from 'react';
import { Download, Calendar, ShieldAlert, UserCheck, X, Maximize2, Filter, ChevronDown, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNotification } from '../context/NotificationContext';

const PPELogs = () => {
  const { showNotification } = useNotification();
  const [logs, setLogs] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const filterRef = useRef(null);

  const fetchLogs = () => {
    setIsSyncing(true);
    const token = localStorage.getItem('vision_token');
    let url = `/api/ppe/logs?t=${Date.now()}`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;

    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setLogs(Array.isArray(data) ? data : []);
        setLastSync(new Date().toLocaleTimeString());
        setTimeout(() => setIsSyncing(false), 500);
      })
      .catch(err => {
        console.error("PPE Logs Fetch Error:", err);
        setIsSyncing(false);
      });
  };

  useEffect(() => {
    fetchLogs();
    
    // Setup Click Outside
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    let socketRef;
    import('socket.io-client').then(({ io }) => {
       socketRef = io();
       socketRef.on('new_alert', (alert) => {
         if (['helmet', 'no_helmet', 'vest', 'no_vest'].includes(alert.class_name)) {
            fetchLogs();
         }
       });
    });
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      socketRef && socketRef.disconnect();
    }
  }, []); // Only fetch on mount and socket events

  const exportToExcel = () => {
    const dataToExport = logs.map(log => ({
      ID: log.id,
      Timestamp: new Date(log.timestamp).toLocaleString(),
      Camera: log.camera_name,
      Violation: log.violation_type.replace('_', ' ').toUpperCase(),
      GlobalID: log.global_id,
      TrackID: log.track_id
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PPE_Violations");
    XLSX.writeFile(wb, `PPE_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    fetchLogs();
    setShowFilters(false);
    showNotification('PPE filters reset successfully.', 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', animation: 'fadeIn 0.5s ease' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>PPE Monitoring</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
             <p style={{ color: 'var(--text-dim)', fontWeight: 600, fontSize: '14px' }}>Safety compliance tracking and violation reports</p>
             <div className="glass-card" style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', fontSize: '11px', borderRadius: '20px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSyncing ? 'var(--primary)' : 'var(--success)', boxShadow: `0 0 10px ${isSyncing ? 'var(--primary--glow)' : 'rgba(16,185,129,0.3)'}` }}></div>
                <span style={{ color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{isSyncing ? 'Syncing...' : `Last Sync: ${lastSync || '---'}`}</span>
             </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', position: 'relative' }} ref={filterRef}>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            style={{ 
              background: showFilters ? 'var(--primary)' : 'var(--glass)', border: '1px solid var(--border)', 
              color: showFilters ? 'white' : 'var(--text-main)', padding: '10px 24px', borderRadius: '14px', 
              display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <Filter size={18} /> Filters {(startDate || endDate) && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />}
            <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: showFilters ? 'rotate(180deg)' : 'none' }} />
          </button>

          <button 
            onClick={exportToExcel}
            className="btn-primary"
            style={{ padding: '10px 24px', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 15px rgba(99,102,241,0.2)' }}
          >
            <Download size={18} /> Export Excel
          </button>

          {/* Floating Filters Card */}
          {showFilters && (
            <div className="glass-card" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: '280px', padding: '20px', zIndex: 1000, animation: 'modalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)', boxShadow: '0 30px 60px rgba(0,0,0,0.4)', background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontWeight: 800, fontSize: '15px', color: 'var(--text-main)' }}>Filter Results</h4>
                    <button onClick={resetFilters} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '11px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                        RESET
                    </button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Start Date & Time</label>
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
                  <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase' }}>End Date & Time</label>
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
                  onClick={() => { fetchLogs(); setShowFilters(false); showNotification('PPE filters applied successfully.', 'success'); }}
                  className="btn-primary"
                  style={{ width: '100%', padding: '12px', borderRadius: '12px', fontWeight: 800, marginTop: '4px' }}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Table Container */}
      <div className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', margin: 0 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '20px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timestamp</th>
                <th style={{ padding: '20px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Event Preview</th>
                <th style={{ padding: '20px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source Camera</th>
                <th style={{ padding: '20px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Class / Violation</th>
                <th style={{ padding: '20px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>System ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="table-row-hover">
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-main)' }}>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', marginTop: '2px' }}>{new Date(log.timestamp).toLocaleDateString()}</div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {log.image_data ? (
                      <div style={{ position: 'relative', width: '70px', height: '44px', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', border: '1.5px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} onClick={() => setSelectedPhoto(log.image_data)}>
                        <img src={`data:image/jpeg;base64,${log.image_data}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="PPE" />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', opacity: 0, transition: 'opacity 0.2s' }} onMouseOver={e=>e.currentTarget.style.opacity=1} onMouseOut={e=>e.currentTarget.style.opacity=0}>
                          <Maximize2 size={14} color="white" />
                        </div>
                      </div>
                    ) : (
                      <div style={{ width: '70px', height: '44px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <UserCheck size={18} color="var(--text-dim)" opacity={0.3} />
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, color: 'var(--text-main)' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 8px var(--primary--glow)' }}></div>
                      {log.camera_name}
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    <span style={{ 
                      padding: '4px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 900,
                      background: log.violation_type.includes('no_') ? 'rgba(244, 63, 94, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                      color: log.violation_type.includes('no_') ? 'var(--accent)' : 'var(--success)',
                      border: `1.5px solid ${log.violation_type.includes('no_') ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)'}`,
                      textTransform: 'uppercase', letterSpacing: '0.02em'
                    }}>
                      {log.violation_type.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 800, fontSize: '13px' }}>
                    #{log.global_id || '---'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ padding: '100px 48px', textAlign: 'center' }}>
                    <ShieldAlert size={56} style={{ opacity: 0.1, marginBottom: '20px' }} />
                    <p style={{ fontWeight: 800, color: 'var(--text-dim)', fontSize: '16px' }}>No safety violations detected in this period.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded View Modal */}
      {selectedPhoto && (
        <div className="modal-overlay" onClick={() => setSelectedPhoto(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(16px)', animation: 'fadeIn 0.3s ease' }}>
          <div className="glass-card" onClick={e => e.stopPropagation()} style={{ width: '95%', maxWidth: '950px', maxHeight: '92vh', padding: '16px', position: 'relative', border: '1.5px solid var(--border)', boxShadow: '0 30px 60px rgba(0,0,0,0.5)', overflow: 'hidden', borderRadius: '32px', background: 'var(--bg-card)' }}>
            <button 
              onClick={() => setSelectedPhoto(null)}
              style={{ 
                position: 'absolute', top: '24px', right: '24px', zIndex: 100, 
                background: 'rgba(244, 63, 94, 0.12)', border: '1.5px solid rgba(244, 63, 94, 0.3)', 
                color: '#f43f5e', width: '40px', height: '40px', borderRadius: '12px', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                cursor: 'pointer', transition: 'all 0.2s', padding: '0'
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(244, 63, 94, 0.2)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(244, 63, 94, 0.12)'}
            >
              <X size={20} strokeWidth={3} />
            </button>
            <div style={{ width: '100%', height: 'auto', maxHeight: 'calc(92vh - 32px)', overflow: 'hidden', borderRadius: '24px', background: '#000', border: '1.5px solid rgba(255,255,255,0.05)' }}>
              <img src={`data:image/jpeg;base64,${selectedPhoto}`} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="Violation Zoom" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PPELogs;
