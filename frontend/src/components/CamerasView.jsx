import React, { useState, useEffect } from 'react'
import { Plus, Check, Play, Settings, Trash2, Power, PowerOff, Monitor, Maximize2, Minimize2, X } from 'lucide-react'

const DETECTION_CLASSES = [
  "person", "person_working", "person_not_working", "person_standing",
  "helmet", "no_helmet", "vest", "no_vest",
  "forklift", "forklift_collision",
  "vehicle", "covered_vehicle", "uncovered_vehicle",
  "license_plate",
  "box_open", "box_close", "box_keeping", "box_throwing"
]

import { io } from 'socket.io-client';

const CamerasView = ({ isViewer = false }) => {
  const [cameras, setCameras] = useState([]);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCam, setEditingCam] = useState(null);
  const [newCam, setNewCam] = useState({ ip_address: '', place_name: '', detections: [] });
  const [maximizedCamId, setMaximizedCamId] = useState(null);
  
  const API_BASE = '/api';
  const WORKER_BASE = `http://${window.location.hostname}:8001`;

  const fetchCameras = () => {
    const token = localStorage.getItem('vision_token');
    fetch('/api/cameras', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
            if (onLogout) onLogout();
            return [];
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setCameras(data.map(c => ({ ...c, showDetect: true })));
        } else {
          setCameras([]);
        }
      })
      .catch(() => setCameras([]));
  };

  useEffect(() => {
    fetchCameras();
    
    let socketRef;
    import('socket.io-client').then(({ io }) => {
       socketRef = io();
       socketRef.on('camera_status', (data) => {
           setCameras(prev => prev.map(c => c.id === data.id ? { ...c, status: data.status } : c));
           if (data.status === 'Active') {
               setTimestamp(Date.now());
           }
       });
    });
    
    return () => socketRef && socketRef.disconnect();
  }, []);

  const handleRestart = (id) => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/cameras-restart/${id}`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(() => {
        setCameras(prev => prev.map(c => c.id === id ? { ...c, status: "Restarting..." } : c));
        // Staggered retries give the AI worker thread time to re-establish connections 
        // to remote streams or YouTube processes before mounting the DOM image component.
        setTimeout(() => setTimestamp(Date.now()), 2000);
        setTimeout(() => setTimestamp(Date.now()), 4000);
        setTimeout(() => setTimestamp(Date.now()), 8000);
        setTimeout(() => setTimestamp(Date.now()), 12000);
      });
  };

  const [testStatus, setTestStatus] = useState(null); // null, 'loading', 'success', 'error'

  const handleTestConnection = () => {
    if (!newCam.ip_address) return alert('Input Required: Please specify a valid camera terminal address.');
    setTestStatus('loading');
    fetch(`/api/test_camera?ip_address=${newCam.ip_address}`)
      .then(res => res.json())
      .then(data => {
        setTestStatus(data.status);
        if (data.status === 'success' && data.url) {
          setNewCam({ ...newCam, ip_address: data.url });
        } else if (data.status === 'error') {
          alert(`Diagnostic Error: Surveillance link could not be verified. (Status: Network Handshake Failure)\n\nVerification Tips:\n1. Ensure the remote device is powered on\n2. Verify the protocol (e.g., http://, rtsp://)\n3. Check if a path suffix (e.g., /video, /stream) is required`);
        }
      })
      .catch(() => setTestStatus('error'));
  };

  const handleSaveCamera = (e) => {
    e.preventDefault();
    const isEdit = !!editingCam;
    const url = isEdit 
      ? `/api/cameras/${editingCam.id}?ip_address=${encodeURIComponent(newCam.ip_address)}&place_name=${encodeURIComponent(newCam.place_name)}&detections=${encodeURIComponent(newCam.detections.join(','))}`
      : `/api/cameras?ip_address=${encodeURIComponent(newCam.ip_address)}&place_name=${encodeURIComponent(newCam.place_name)}&detections=${encodeURIComponent(newCam.detections.join(','))}`;
    
    const token = localStorage.getItem('vision_token');
    fetch(url, { 
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error(`Server ${res.status}: Failed to commit configuration change.`);
      return res.json();
    })
    .then(savedCam => {
      console.log('Camera Config Saved:', savedCam);
      if (isEdit) {
        setCameras(prev => prev.map(c => c.id === savedCam.id ? { ...c, ...savedCam } : c));
      } else {
        setCameras(prev => [...prev, savedCam]);
      }
      setShowAddModal(false);
      setEditingCam(null);
      setTestStatus(null);
      setNewCam({ ip_address: '', place_name: '', detections: [] });
    })
    .catch(err => {
      console.error('Update Error:', err);
      const isAuthError = err.message.includes('403') || err.message.includes('401');
      const msg = isAuthError 
        ? 'Your session has expired. Please log out and log in again to continue.'
        : 'Sync Failure: ' + err.message + '\n\nPlease check the terminal for worker communication details.';
      alert(msg);
      if (isAuthError && onLogout) onLogout();
    });
  };

  const handleDelete = (id) => {
    if (!window.confirm('System Confirmation: Proceed with the permanent removal of this surveillance endpoint from the active registry?')) return;
    const token = localStorage.getItem('vision_token');
    fetch(`/api/cameras/${id}`, { 
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(() => {
        setCameras(prev => prev.filter(c => c.id !== id));
      });
  };

  const handleToggle = (id) => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/cameras-toggle/${id}`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setCameras(prev => prev.map(c => c.id === id ? { ...c, is_active: data.is_active } : c));
      });
  };

  const handleEdit = (cam) => {
    setEditingCam(cam);
    let detections = [];
    if (typeof cam.detections_to_run === 'string') {
        detections = cam.detections_to_run.split(',').filter(x => x);
    } else if (Array.isArray(cam.detections_to_run)) {
        detections = cam.detections_to_run;
    }
    setNewCam({ 
      ip_address: cam.ip_address, 
      place_name: cam.place_name, 
      detections: detections
    });
    setShowAddModal(true);
  };

  const toggleDetection = (clsName) => {
    const updated = [...newCam.detections];
    if (updated.includes(clsName)) {
      updated.splice(updated.indexOf(clsName), 1);
    } else {
      updated.push(clsName);
    }
    setNewCam({ ...newCam, detections: updated });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px' }}>{isViewer ? 'Live Monitoring' : 'Camera Management'}</h2>
          <p style={{ color: 'var(--text-dim)', fontWeight: 700 }}>{isViewer ? 'Stream detection & analytics' : 'Add and configure video sources'}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setTimestamp(Date.now())} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)', fontSize: '13px' }}>
            Refresh Streams
          </button>
          {!isViewer && (
            <button onClick={() => { setEditingCam(null); setNewCam({ ip_address: '', place_name: '', detections: [] }); setShowAddModal(true); }} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plus size={18} /> Add New Cam
            </button>
          )}
        </div>
      </header>

      <div className="grid-layout">
        {cameras.filter(c => !isViewer || c.is_active).map(cam => (
          <React.Fragment key={cam.id}>
            {/* Normal View Card */}
            <div className="glass-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h4 style={{ fontSize: '18px', fontWeight: 800 }}>{cam.place_name} {isViewer && '(Normal)'}</h4>
                    <span style={{ 
                      fontSize: '10px', padding: '2px 6px', borderRadius: '4px',
                      background: cam.status === 'Active' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                      color: cam.status === 'Active' ? 'var(--success)' : 'var(--accent)',
                      border: `1px solid ${cam.status === 'Active' ? 'var(--success)' : 'var(--accent)'}`
                    }}>
                      {cam.status}
                    </span>
                  </div>
                  {/* IP display removed for privacy */}
                </div>
                {!isViewer && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => handleToggle(cam.id)} 
                      title={cam.is_active ? "Deactivate" : "Activate"}
                      style={{ 
                        padding: '8px', 
                        background: cam.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
                        color: cam.is_active ? 'var(--success)' : 'var(--text-dim)',
                        border: `1px solid ${cam.is_active ? 'rgba(16,185,129,0.2)' : 'transparent'}`
                      }}
                    >
                      <Power size={16} />
                    </button>
                    <button onClick={() => handleEdit(cam)} style={{ padding: '8px', background: 'rgba(255,255,255,0.05)' }}>
                      <Settings size={16} />
                    </button>
                    <button onClick={() => handleDelete(cam.id)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', background: 'rgba(255,0,0,0.1)', color: 'var(--accent)', border: '1px solid rgba(255,0,0,0.2)' }}>
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                )}
              </div>
              {isViewer ? (
                <div className="stream-container" style={{ position: 'relative' }}>
                  <img 
                    key={`${cam.id}-${cam.showDetect}`}
                    className="stream-img" 
                    src={`${WORKER_BASE}/video_feed/${cam.id}?detect=${!!cam.showDetect}&t=${timestamp}`} 
                    alt="stream" 
                  />
                  {cam.status === 'Stream Ended' && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 11, borderRadius: '8px' }}>
                        <button onClick={() => handleRestart(cam.id)} style={{ padding: '12px 24px', background: 'var(--primary)', color: 'white', borderRadius: '8px', fontSize: '14px', border: 'none', cursor: 'pointer', display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 'bold' }}>
                            <Play size={18} fill="currentColor" /> Relaunch Stream
                        </button>
                    </div>
                  )}
                  <div style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    display: 'flex',
                    gap: '8px',
                    zIndex: 10
                  }}>
                    <button 
                      className="icon-btn"
                      onClick={() => setMaximizedCamId(cam.id)}
                      title="Maximize"
                    >
                      <Maximize2 size={16} />
                    </button>
                    <button 
                      onClick={() => {
                        setCameras(prev => prev.map(c => c.id === cam.id ? {...c, showDetect: !c.showDetect} : c));
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        borderRadius: '20px',
                        background: cam.showDetect ? 'var(--success)' : 'rgba(0,0,0,0.5)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.2)',
                        backdropFilter: 'blur(5px)',
                        cursor: 'pointer'
                      }}
                    >
                      {cam.showDetect ? "Off" : "On"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  height: '180px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: '8px', color: 'var(--text-dim)',
                  border: '1px dashed rgba(255,255,255,0.1)'
                }}>
                  <Monitor size={32} opacity={0.3} />
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>Streaming disabled in Management Mode</span>
                </div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
            <h3 style={{ marginBottom: '20px' }}>{editingCam ? 'Edit Camera' : 'Register New Camera'}</h3>
            <form onSubmit={handleSaveCamera} style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ fontSize: '13px', marginBottom: '4px' }}>Camera IP / Encode URL</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input type="text" placeholder="rtsp://... or 192.168..." required value={newCam.ip_address} onChange={e => setNewCam({...newCam, ip_address: e.target.value})} style={{ flex: 1, marginBottom: 0 }} />
                <button type="button" onClick={handleTestConnection} disabled={testStatus === 'loading'} style={{ 
                  background: testStatus === 'success' ? 'var(--success)' : testStatus === 'error' ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                  padding: '0 16px', fontSize: '12px'
                }}>
                  {testStatus === 'loading' ? '...' : testStatus === 'success' ? 'Ready' : testStatus === 'error' ? 'Retry' : 'Test'}
                </button>
              </div>
              
              <label style={{ fontSize: '13px', marginBottom: '4px' }}>Place Name</label>
              <input type="text" placeholder="Warehouse Section A" required value={newCam.place_name} onChange={e => setNewCam({...newCam, place_name: e.target.value})} />
              
              <label style={{ fontSize: '13px', marginBottom: '12px' }}>Detections to active</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px', maxHeight: '200px', overflowY: 'auto' }}>
                {DETECTION_CLASSES.map((cls, idx) => (
                  <div key={idx} onClick={() => toggleDetection(cls)} style={{ 
                    padding: '8px', background: newCam.detections.includes(cls) ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px'
                  }}>
                    {newCam.detections.includes(cls) ? <Check size={12} /> : <div style={{width: 12}} />}
                    {cls}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" style={{ flex: 1 }}>{editingCam ? 'Update Camera' : 'Save Camera'}</button>
                <button type="button" onClick={() => setShowAddModal(false)} style={{ background: 'var(--accent)', flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Fullscreen Overlay */}
      {maximizedCamId && cameras.find(c => c.id === maximizedCamId) && (
        <div className="fullscreen-overlay">
          <div className="fullscreen-header">
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 800 }}>{cameras.find(c => c.id === maximizedCamId).place_name}</h2>
              <p style={{ color: 'var(--text-dim)', fontWeight: 700 }}>Immersive Monitoring Mode</p>
            </div>
            <button className="icon-btn" style={{ width: '48px', height: '48px' }} onClick={() => setMaximizedCamId(null)}>
              <Minimize2 size={24} />
            </button>
          </div>
          <div className="fullscreen-stream-container">
            <img 
              className="stream-img" 
              src={`${WORKER_BASE}/video_feed/${maximizedCamId}?detect=true&t=${timestamp}`} 
              alt="fullscreen stream" 
              style={{ objectFit: 'contain' }}
            />
            <button 
              className="icon-btn" 
              style={{ position: 'absolute', top: '24px', right: '24px', width: '48px', height: '48px' }} 
              onClick={() => setMaximizedCamId(null)}
            >
              <X size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CamerasView;
