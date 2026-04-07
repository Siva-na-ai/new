import React, { useState, useEffect } from 'react';
import { Search, Download, Calendar, ShieldAlert, UserCheck, X, Maximize2 } from 'lucide-react';
import * as XLSX from 'xlsx';

const PPELogs = () => {
  const [logs, setLogs] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const fetchLogs = () => {
    setIsSyncing(true);
    const token = localStorage.getItem('vision_token');
    let url = `/api/ppe/logs?t=${Date.now()}`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}`;
    if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;

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
    
    let socketRef;
    import('socket.io-client').then(({ io }) => {
       socketRef = io();
       socketRef.on('new_alert', (alert) => {
         if (['helmet', 'no_helmet', 'vest', 'no_vest'].includes(alert.class_name)) {
            setTimeout(fetchLogs, 500); // Small delay to let DB settle
         }
       });
    });
    
    return () => socketRef && socketRef.disconnect();
  }, [startDate, endDate, searchTerm]);

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

  const filteredLogs = logs.filter(log => {
    const cam = (log.camera_name || "").toLowerCase();
    const type = (log.violation_type || "").toLowerCase();
    const gid = (log.global_id || "").toString().toLowerCase();
    const search = searchTerm.toLowerCase();
    return cam.includes(search) || type.includes(search) || gid.includes(search);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800 }}>PPE Monitoring</h2>
          <p className="mega-bold-white">Safety compliance tracking and violation reports</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', fontSize: '11px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSyncing ? 'var(--primary)' : 'var(--success)', boxShadow: `0 0 10px ${isSyncing ? 'var(--primary)' : 'var(--success)'}` }}></div>
            <span className="mega-bold-white">{isSyncing ? 'Syncing...' : `Last Sync: ${lastSync || '---'}`}</span>
          </div>
          <button 
            onClick={exportToExcel}
            style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '10px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' }}
          >
            <Download size={18} /> Export Excel
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="glass-card" style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '24px', alignItems: 'end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="mega-bold-white" style={{ fontSize: '12px' }}>SEARCH CAMERA / VIOLATION</label>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'white' }} />
            <input 
              type="text" 
              placeholder="e.g. Cam 1, no_helmet..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '6px 12px 6px 36px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '10px', color: 'white' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="mega-bold-white" style={{ fontSize: '12px' }}>START DATE</label>
          <input 
            type="datetime-local" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width: '200px', padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '10px', color: 'white' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="mega-bold-white" style={{ fontSize: '12px' }}>END DATE</label>
          <input 
            type="datetime-local" 
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ width: '200px', padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '10px', color: 'white' }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
              <th className="mega-bold-white" style={{ padding: '16px 24px', fontSize: '12px' }}>TIMESTAMP</th>
              <th className="mega-bold-white" style={{ padding: '16px 24px', fontSize: '12px' }}>PHOTO</th>
              <th className="mega-bold-white" style={{ padding: '16px 24px', fontSize: '12px' }}>CAMERA</th>
              <th className="mega-bold-white" style={{ padding: '16px 24px', fontSize: '12px' }}>DETECTED</th>
              <th className="mega-bold-white" style={{ padding: '16px 24px', fontSize: '12px' }}>GLOBAL ID</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="table-row-hover">
                <td style={{ padding: '16px 24px' }}>
                  <div style={{ fontWeight: 600 }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                  <div className="mega-bold-white" style={{ fontSize: '11px' }}>{new Date(log.timestamp).toLocaleDateString()}</div>
                </td>
                <td style={{ padding: '16px 24px' }}>
                  {log.image_data ? (
                    <div style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--border)' }} onClick={() => setSelectedPhoto(log.image_data)}>
                      <img src={`data:image/jpeg;base64,${log.image_data}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="PPE" />
                      <div style={{ position: 'absolute', bottom: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', borderRadius: '4px', padding: '2px' }}>
                        <Maximize2 size={10} color="white" />
                      </div>
                    </div>
                  ) : (
                    <div style={{ width: '60px', height: '60px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <UserCheck size={20} color="var(--text-dim)" />
                    </div>
                  )}
                </td>
                <td style={{ padding: '16px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)' }}></div>
                    {log.camera_name}
                  </div>
                </td>
                <td style={{ padding: '16px 24px' }}>
                  <span style={{ 
                    padding: '4px 10px', 
                    borderRadius: '20px', 
                    fontSize: '11px', 
                    fontWeight: 700,
                    background: log.violation_type.includes('no_') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: log.violation_type.includes('no_') ? '#ef4444' : '#10b981',
                    border: `1px solid ${log.violation_type.includes('no_') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                    textTransform: 'uppercase'
                  }}>
                    {log.violation_type.replace('_', ' ')}
                  </span>
                </td>
                <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 700 }}>
                  #{log.global_id || '---'}
                </td>
              </tr>
            ))}
            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan="5" style={{ padding: '48px', textAlign: 'center' }}>
                  <ShieldAlert size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                  <p className="mega-bold-white">No PPE violations found for the selected criteria.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Photo Modal */}
      {selectedPhoto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }} onClick={() => setSelectedPhoto(null)}>
          <button style={{ position: 'absolute', top: '20px', right: '20px', background: 'white', border: 'none', borderRadius: '50%', p: '8px', cursor: 'pointer' }}>
            <X size={24} color="black" />
          </button>
          <img src={`data:image/jpeg;base64,${selectedPhoto}`} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '12px', boxShadow: '0 0 50px rgba(0,0,0,0.5)' }} alt="Violation Zoom" />
        </div>
      )}
    </div>
  );
};

export default PPELogs;
