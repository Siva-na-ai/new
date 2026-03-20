import React, { useState, useEffect } from 'react'
import { Youtube, Plus, Play, Trash2, Check, Video, Settings, X } from 'lucide-react'

const DETECTION_CLASSES = [
  "box_opened", "box_closed", "person", "forklift", "collision", "helmet", "no_helmet", "no_vest", "vest", "license_plate", "truck_covered", "truck_not_covered", "person_not_working", "person_standing", "person_working"
]

const YoutubeView = () => {
  const [cams, setCams] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingCam, setEditingCam] = useState(null);
  const [newUrl, setNewUrl] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [detections, setDetections] = useState([2, 5, 8, 9]); // Default to person, helmet, vest, plate
  const [timestamp, setTimestamp] = useState(Date.now());
  
  const API_HOST = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '127.0.0.1:8000' : `${window.location.hostname}:8000`;
  const API_BASE = `${window.location.protocol}//${API_HOST}`;

  const fetchCams = () => {
    fetch('/api/cameras')
      .then(res => res.json())
      .then(data => {
        // Only show YT cams
        setCams(data.filter(c => c.ip_address.includes('youtube.com') || c.ip_address.includes('youtu.be')));
        setTimestamp(Date.now());
      });
  };

  useEffect(() => {
    fetchCams();
    const interval = setInterval(fetchCams, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveYoutube = (e) => {
    e.preventDefault();
    if (!newUrl.includes('youtube.com') && !newUrl.includes('youtu.be')) {
      alert('Invalid Resource: Provided link does not match a verified YouTube video or stream format.');
      return;
    }

    const label = placeName || 'YouTube Analysis';
    const url = editingCam 
      ? `/api/cameras/${editingCam.id}?ip_address=${newUrl}&place_name=${label}&detections=${detections.join(',')}`
      : `/api/cameras?ip_address=${newUrl}&place_name=${label}&detections=${detections.join(',')}`;

    fetch(url, { method: editingCam ? 'PUT' : 'POST' })
    .then(res => res.json())
    .then(() => {
      fetchCams();
      setShowAdd(false);
      setEditingCam(null);
      setNewUrl('');
      setPlaceName('');
      setDetections([2, 5, 8, 9]);
    });
  };

  const handleDelete = (id) => {
    if (!window.confirm('System Confirmation: Terminate real-time analytical processing for this stream?')) return;
    fetch(`/api/cameras/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchCams());
  };

  const handleEdit = (cam) => {
    setEditingCam(cam);
    setNewUrl(cam.ip_address);
    setPlaceName(cam.place_name);
    setDetections(cam.detections_to_run || []);
    setShowAdd(true);
  };

  const toggleDetection = (index) => {
    const updated = [...detections];
    if (updated.includes(index)) {
      updated.splice(updated.indexOf(index), 1);
    } else {
      updated.push(index);
    }
    setDetections(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Youtube size={32} color="#FF0000" /> YouTube Live Analysis
          </h2>
          <p style={{ color: 'var(--text-dim)' }}>Analyzing 1 frame every 30 for optimized cloud/social processing</p>
        </div>
        <button onClick={() => { setEditingCam(null); setNewUrl(''); setPlaceName(''); setDetections([2,5,8,9]); setShowAdd(true); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FF0000' }}>
          <Plus size={18} /> New YT Stream
        </button>
      </header>

      <div className="grid-layout">
        {cams.map(cam => (
          <div key={cam.id} className="glass-card" style={{ padding: '16px', border: '1px solid rgba(255,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <h4 style={{ fontSize: '18px' }}>{cam.place_name}</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <span className={`status-dot ${cam.status === 'Active' ? 'active' : ''}`}></span>
                  <span style={{ fontSize: '12px', color: cam.status === 'Active' ? 'var(--success)' : 'var(--accent)' }}>
                    {cam.status} (1/30 Skip)
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => handleEdit(cam)} style={{ padding: '8px', background: 'rgba(255,255,255,0.05)', border: 'none' }}>
                  <Settings size={16} />
                </button>
                <button onClick={() => handleDelete(cam.id)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', background: 'rgba(255,0,0,0.1)', color: '#FF0000', border: '1px solid rgba(255,0,0,0.2)' }}>
                  <Trash2 size={16} /> Delete Stream
                </button>
              </div>
            </div>

            <div className="stream-container">
              <img className="stream-img" src={`${API_BASE}/video_feed/${cam.id}?detect=true&t=${timestamp}`} alt="yt stream" />
              <div style={{ 
                position: 'absolute', top: '10px', right: '10px', 
                background: 'rgba(255,0,0,0.8)', color: 'white', 
                padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold'
              }}>
                LIVE ANALYSIS
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Video size={20} color="#FF0000" /> {editingCam ? 'Update YouTube Analysis' : 'Start YouTube Analysis'}
              </h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'transparent', padding: '4px' }}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveYoutube}>
              <label style={{ fontSize: '13px', marginBottom: '4px' }}>YouTube URL</label>
              <input 
                type="text" 
                placeholder="https://www.youtube.com/watch?v=..." 
                required 
                value={newUrl} 
                onChange={e => setNewUrl(e.target.value)} 
              />
              
              <label style={{ fontSize: '13px', marginBottom: '4px' }}>Dashboard Label (Optional)</label>
              <input 
                type="text" 
                placeholder="e.g. Traffic Monitor" 
                value={placeName} 
                onChange={e => setPlaceName(e.target.value)} 
              />

              <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '12px', color: '#FF0000' }}>
                  Select Detection Classes
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px', maxHeight: '180px', overflowY: 'auto', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                {DETECTION_CLASSES.map((cls, idx) => (
                  <div key={idx} onClick={() => toggleDetection(idx)} style={{ 
                    padding: '8px', background: detections.includes(idx) ? 'rgba(255,0,0,0.2)' : 'rgba(255,255,255,0.05)',
                    border: detections.includes(idx) ? '1px solid #FF0000' : '1px solid transparent',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '8px'
                  }}>
                    {detections.includes(idx) ? <Check size={12} color="#FF0000" /> : <div style={{width: 12}} />}
                    {cls}
                  </div>
                ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" style={{ flex: 1, background: '#FF0000' }}>{editingCam ? 'Update Analysis' : 'Start Analysis'}</button>
                <button type="button" onClick={() => setShowAdd(false)} style={{ background: 'var(--bg-card)', flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default YoutubeView;
