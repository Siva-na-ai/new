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
import { useNotification } from '../context/NotificationContext';

const CamerasView = ({ isViewer = false, onLogout }) => {
  const { showNotification } = useNotification();
  const [cameras, setCameras] = useState([]);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCam, setEditingCam] = useState(null);
  const [newCam, setNewCam] = useState({ ip_address: '', place_name: '', detections: [] });
  const [maximizedCamId, setMaximizedCamId] = useState(null);
  
  const API_BASE = '/api';
  const WORKER_BASE = `http://${window.location.hostname}:8001`;

  const fetchCameras = (signal) => {
    const token = localStorage.getItem('vision_token');
    fetch('/api/cameras', {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: signal
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
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
      .catch((err) => {
        if (err.name !== 'AbortError') setCameras([]);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchCameras(controller.signal);
    
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
    
    return () => {
      controller.abort();
      if (socketRef) socketRef.disconnect();
    };
  }, []);

  const handleRestart = (id) => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/cameras-restart/${id}`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.json() : Promise.reject('Failed'))
      .then(() => {
        setCameras(prev => prev.map(c => c.id === id ? { ...c, status: "Connecting..." } : c));
        showNotification('Reconnection queued. Camera will come online in a few seconds.', 'success');
        setTimeout(() => setTimestamp(Date.now()), 3000);
      })
      .catch(() => showNotification('Worker communication timed out. The system is still attempting reconnect.', 'error'));
  };

  const [testStatus, setTestStatus] = useState(null); // null, 'loading', 'success', 'error'

  const handleTestConnection = () => {
    if (!newCam.ip_address) return showNotification('Terminal address is required for testing.', 'error');
    setTestStatus('loading');
    fetch(`/api/test_camera?ip_address=${newCam.ip_address}`)
      .then(res => res.json())
      .then(data => {
        setTestStatus(data.status);
        if (data.status === 'success' && data.url) {
          setNewCam({ ...newCam, ip_address: data.url });
          showNotification('Connection verified successfully.', 'success');
        } else {
          showNotification('Surveillance link could not be verified.', 'error');
        }
      })
      .catch(() => {
        setTestStatus('error');
        showNotification('Network Diagnostic: Handshake failed.', 'error');
      });
  };

  const handleSaveCamera = (e) => {
    e.preventDefault();
    const isEdit = !!editingCam;
    const url = isEdit ? `/api/cameras/${editingCam.id}` : `/api/cameras`;
    
    // Switch to using a JSON body for better handling of long URLs and complex paths
    const payload = {
      ip_address: newCam.ip_address,
      place_name: newCam.place_name,
      detections: newCam.detections.join(',')
    };
    
    const token = localStorage.getItem('vision_token');
    fetch(url, { 
      method: isEdit ? 'PUT' : 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) throw new Error(`Server ${res.status}`);
      return res.json();
    })
    .then(savedCam => {
      if (isEdit) {
        setCameras(prev => prev.map(c => c.id === savedCam.id ? { ...c, ...savedCam } : c));
        showNotification('Camera configuration updated.', 'success');
      } else {
        setCameras(prev => [...prev, savedCam]);
        showNotification('New camera registered successfully.', 'success');
      }
      setShowAddModal(false);
      setEditingCam(null);
      setTestStatus(null);
      setNewCam({ ip_address: '', place_name: '', detections: [] });
    })
    .catch(err => {
      showNotification('Configuration Sync Failure: ' + err.message, 'error');
    });
  };

  const handleDelete = (id) => {
    if (!window.confirm('Confirm permanent removal of this camera endpoint?')) return;
    const token = localStorage.getItem('vision_token');
    fetch(`/api/cameras/${id}`, { 
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => {
        setCameras(prev => prev.filter(c => c.id !== id));
        showNotification('Camera removed from active registry.', 'success');
      })
      .catch(() => showNotification('Error deleting camera terminal.', 'error'));
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
        showNotification(`Camera ${data.is_active ? 'Activated' : 'Suspended'} successfully.`, 'success');
      })
      .catch(() => showNotification('Failed to toggle camera state.', 'error'));
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
            <button 
              onClick={() => { setEditingCam(null); setNewCam({ ip_address: '', place_name: '', detections: [] }); setShowAddModal(true); }} 
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={18} /> Add New Cam
            </button>
          )}
        </div>
      </header>

      {!isViewer ? (
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ margin: 0, width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Camera ID</th>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</th>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resolution</th>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>FPS</th>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ padding: '16px 24px', fontSize: '12px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map(cam => (
                  <tr key={cam.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="table-row-hover">
                    <td style={{ padding: '16px 24px', fontWeight: 800, color: 'var(--text-main)', fontSize: '14px' }}>
                      {`CAM-${String(cam.id).padStart(4, '0')}`}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Monitor size={16} style={{ color: 'var(--primary)', opacity: 0.6 }} />
                        <span style={{ fontWeight: 700 }}>{cam.place_name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', fontWeight: 800, opacity: 0.8, fontSize: '13px' }}>1080P</td>
                    <td style={{ padding: '16px 24px', fontWeight: 800, opacity: 0.8, fontSize: '13px' }}>
                      {cam.status === 'Active' ? '30 fps' : '0 fps'}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ 
                        fontSize: '11px', padding: '4px 10px', borderRadius: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.02em',
                        background: (cam.status === 'Active' || cam.status === 'Reconnecting...') ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                        color: (cam.status === 'Active' || cam.status === 'Reconnecting...') ? 'var(--success)' : 'var(--accent)',
                        border: `1px solid ${(cam.status === 'Active' || cam.status === 'Reconnecting...') ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`
                      }}>
                        {(cam.status === 'Active' || cam.status === 'Reconnecting...') ? 'Active' : 'Stopped'}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button 
                          onClick={() => handleToggle(cam.id)} 
                          title={cam.is_active ? "Deactivate" : "Activate"}
                          style={{ 
                            padding: '8px', minWidth: 'auto',
                            background: cam.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
                            color: cam.is_active ? 'var(--success)' : 'var(--text-dim)',
                            border: `1px solid ${cam.is_active ? 'rgba(16,185,129,0.2)' : 'var(--border)'}`,
                            borderRadius: '10px'
                          }}
                        >
                          <Power size={18} />
                        </button>
                        <button 
                          onClick={() => handleEdit(cam)} 
                          title="Configuration"
                          style={{ 
                            padding: '8px', minWidth: 'auto', 
                            background: 'rgba(255,255,255,0.08)', 
                            border: '1.5px solid var(--border)', 
                            borderRadius: '10px',
                            color: 'var(--text-main)',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                          }}
                        >
                          <Settings size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(cam.id)} 
                          title="Remove Camera"
                          style={{ padding: '8px', minWidth: 'auto', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', color: 'var(--accent)', borderRadius: '10px' }}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cameras.length === 0 && (
            <div style={{ padding: '80px', textAlign: 'center', color: 'var(--text-dim)' }}>
              <Monitor size={48} opacity={0.1} style={{ marginBottom: '16px' }} />
              <p style={{ fontWeight: 800 }}>No surveillance endpoints registered.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid-layout">
          {cameras.filter(c => c.is_active).map(cam => (
            <div key={cam.id} className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 800 }}>{cam.place_name}</h4>
                <span style={{ 
                  fontSize: '11px', padding: '3px 8px', borderRadius: '6px', fontWeight: 800,
                  background: cam.status === 'Active' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                  color: cam.status === 'Active' ? 'var(--success)' : 'var(--accent)',
                  border: `1px solid ${cam.status === 'Active' ? 'var(--success)' : 'var(--accent)'}`
                }}>
                  {cam.status}
                </span>
              </div>
              
              <div className="stream-container" style={{ position: 'relative' }}>
                <img 
                  key={`${cam.id}-${cam.showDetect}`}
                  className="stream-img" 
                  src={`${WORKER_BASE}/video_feed/${cam.id}?detect=${!!cam.showDetect}&t=${timestamp}`} 
                  alt="stream" 
                />
                <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '8px', zIndex: 10 }}>
                  <button className="icon-btn" onClick={() => setMaximizedCamId(cam.id)}>
                    <Maximize2 size={16} />
                  </button>
                  <button 
                    onClick={() => {
                      setCameras(prev => prev.map(c => c.id === cam.id ? {...c, showDetect: !c.showDetect} : c));
                    }}
                    style={{
                      padding: '6px 12px', fontSize: '12px', borderRadius: '20px',
                      background: cam.showDetect ? 'var(--success)' : 'rgba(0,0,0,0.5)',
                      color: 'white', border: '1px solid rgba(255,255,255,0.2)',
                      backdropFilter: 'blur(5px)', cursor: 'pointer'
                    }}
                  >
                    AI {cam.showDetect ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(12px)', transition: 'all 0.3s' }}>
          <div className="glass-card modal-content" style={{ 
            width: '560px', borderRadius: '32px', border: '1.5px solid var(--border)', 
            boxShadow: '0 40px 80px rgba(0,0,0,0.6)', background: 'var(--bg-card)', padding: '40px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h3 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
                  {editingCam ? 'Edit Camera' : 'Register New Camera'}
                </h3>
                <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginTop: '4px', fontWeight: 600 }}>Configure surveillance terminal settings</p>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent)', border: 'none', padding: '8px', borderRadius: '12px', boxShadow: 'none' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCamera} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Camera Terminal IP / URL</label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input 
                    type="text" 
                    placeholder="rtsp://... or http://..." 
                    required 
                    value={newCam.ip_address} 
                    onChange={e => setNewCam({...newCam, ip_address: e.target.value})} 
                    style={{ 
                      flex: 1, marginBottom: 0, padding: '14px 18px', borderRadius: '14px', fontSize: '15px', 
                      background: '#fff', color: '#000', fontWeight: 600, border: '2px solid transparent'
                    }}
                    className="light-date-input" 
                  />
                  <button 
                    type="button" 
                    onClick={handleTestConnection} 
                    disabled={testStatus === 'loading'} 
                    style={{ 
                      background: testStatus === 'success' ? 'var(--success)' : testStatus === 'error' ? 'var(--accent)' : 'var(--primary)',
                      padding: '0 24px', fontSize: '13px', fontWeight: 800, borderRadius: '14px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                    }}
                  >
                    {testStatus === 'loading' ? 'Testing...' : testStatus === 'success' ? 'Verified' : testStatus === 'error' ? 'Retry' : 'Test'}
                  </button>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Display Name / Location</label>
                <input 
                  type="text" 
                  placeholder="e.g. Warehouse Main Entrance" 
                  required 
                  value={newCam.place_name} 
                  onChange={e => setNewCam({...newCam, place_name: e.target.value})} 
                  style={{ 
                    marginBottom: 0, padding: '14px 18px', borderRadius: '14px', fontSize: '15px', 
                    background: '#fff', color: '#000', fontWeight: 600, border: '2px solid transparent'
                  }}
                  className="light-date-input"
                />
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Detections to Activate</label>
                <div style={{ 
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px',
                  scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent'
                }}>
                  {DETECTION_CLASSES.map((cls, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => toggleDetection(cls)} 
                      style={{ 
                        padding: '12px 16px', 
                        background: newCam.detections.includes(cls) ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                        border: `1.5px solid ${newCam.detections.includes(cls) ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: '12px', 
                        cursor: 'pointer', 
                        fontSize: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px',
                        fontWeight: 700,
                        color: newCam.detections.includes(cls) ? 'white' : 'var(--text-dim)',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ 
                        width: '18px', height: '18px', borderRadius: '5px', 
                        border: `2px solid ${newCam.detections.includes(cls) ? 'rgba(255,255,255,0.4)' : 'var(--text-dim)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: newCam.detections.includes(cls) ? 'rgba(255,255,255,0.2)' : 'rgba(128,128,128,0.05)',
                        opacity: newCam.detections.includes(cls) ? 1 : 0.6,
                        transition: 'all 0.2s'
                      }}>
                        {newCam.detections.includes(cls) && <Check size={12} color="white" strokeWidth={4} />}
                      </div>
                      {cls.replace(/_/g, ' ').toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 2, padding: '16px', borderRadius: '16px', fontSize: '15px', fontWeight: 800 }}>
                  {editingCam ? 'Update Cam' : 'Add Cam'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setShowAddModal(false)} 
                  className="btn-secondary"
                  style={{ flex: 1, borderRadius: '16px', fontWeight: 800 }}
                >
                  Cancel
                </button>
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
