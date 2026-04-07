import React, { useState, useEffect, useRef } from 'react'
import { ShieldAlert, Plus, Trash2, CheckCircle2, AlertTriangle, Monitor, MapPin } from 'lucide-react'

const RestrictionArea = () => {
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [points, setPoints] = useState([]);
  const [existingZones, setExistingZones] = useState([]);
  const [activationTime, setActivationTime] = useState('');
  const [imgSize, setImgSize] = useState({ w: 1280, h: 720 });
  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('vision_token');
    fetch('/api/cameras', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setCameras(data));
  }, []);

  const fetchZones = (camId) => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/zones/${camId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch zones');
        return res.json();
      })
      .then(data => setExistingZones(Array.isArray(data) ? data : []))
      .catch(err => {
        console.error(err);
        setExistingZones([]);
      });
  };

  useEffect(() => {
    if (selectedCam) fetchZones(selectedCam.id);
  }, [selectedCam]);

  const handleCanvasClick = (e) => {
    if (!selectedCam) return;
    const img = imgRef.current;
    if (!img) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Refresh imgSize from actual image just in case it changed
    const currentW = img.naturalWidth || 1280;
    const currentH = img.naturalHeight || 720;
    setImgSize({ w: currentW, h: currentH });

    // Store points as normalized coordinates (0 to 1)
    const normX = x / rect.width;
    const normY = y / rect.height;
    
    setPoints(prev => [...prev, [normX, normY]]);
  };

  const drawPolygon = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Draw Existing Zones (Blue)
    if (existingZones && existingZones.length > 0) {
      existingZones.forEach(zone => {
        const zp_raw = zone.polygon_points;
        const zp = Array.isArray(zp_raw) ? zp_raw : (zp_raw?.points || []);
        const ref_w = zp_raw?.width || imgSize.w;
        const ref_h = zp_raw?.height || imgSize.h;
        
        if (zp.length > 2) {
          ctx.beginPath();
          ctx.strokeStyle = '#3b82f6'; // Blue for existing
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          
          zp.forEach((p, i) => {
            // Check if point is normalized (0-1) or absolute pixels (legacy)
            const isNorm = p[0] <= 1.0 && p[1] <= 1.0;
            const px = isNorm ? p[0] * imgSize.w : p[0] * scale_x;
            const py = isNorm ? p[1] * imgSize.h : p[1] * scale_y;
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
        }
      });
    }

    // 2. Draw Current Points (New Polygon - Red)
    if (points.length === 0) return;
    
    ctx.beginPath();
    ctx.strokeStyle = '#f43f5e'; // Red for new
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(244, 63, 94, 0.3)';
    
    points.forEach((p, i) => {
      const px = p[0] * imgSize.w;
      const py = p[1] * imgSize.h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    
    if (points.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.fill();

    // Draw points
    points.forEach(p => {
       ctx.beginPath();
       ctx.arc(p[0] * imgSize.w, p[1] * imgSize.h, 5, 0, Math.PI * 2);
       ctx.fillStyle = 'white';
       ctx.fill();
    });
  };

  useEffect(() => {
    drawPolygon();
  }, [points, existingZones, imgSize]);

  const handleSubmitZone = () => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/zones?camera_id=${selectedCam.id}&activation_time=${activationTime}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ points, type: 'normalized', width: imgSize.w, height: imgSize.h })
    })
    .then(res => res.json())
    .then(() => {
      alert('Restriction zone active for ' + selectedCam.place_name);
      setPoints([]);
      setActivationTime('');
      fetchZones(selectedCam.id);
    });
  };

  const handleDeleteZone = (zoneId) => {
    const token = localStorage.getItem('vision_token');
    fetch(`/api/zones/${zoneId}`, { 
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(() => fetchZones(selectedCam.id));
  };

  const handleImgLoad = (e) => {
    setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  };

  return (
    <div style={{ padding: '24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 800 }}>Restriction Zones</h2>
          <p className="mega-bold-white">Define exclusion polygons for automated alerts</p>
        </div>
        {points.length > 0 && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setPoints([])} style={{ background: 'var(--glass)', color: 'white' }}>
              <Trash2 size={18} /> Clear Points
            </button>
            <button onClick={handleSubmitZone} disabled={points.length < 3}>
              <CheckCircle2 size={18} /> Save Zone ({points.length} pts)
            </button>
          </div>
        )}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '32px' }}>
        <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
          {!selectedCam ? (
            <div style={{ padding: '80px', textAlign: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>
              <Monitor size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
              <p className="mega-bold-white" style={{ fontSize: '18px' }}>Select a camera from the sidebar to begin defining zones.</p>
            </div>
          ) : (
            <div className="stream-container stream-editor" style={{ borderRadius: 0, height: 'auto' }}>
              <img 
                ref={imgRef}
                className="stream-img" 
                src={`http://${window.location.hostname}:8001/video_feed/${selectedCam.id}?detect=false`} 
                alt="stream" 
                style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'contain' }}
                onLoad={(e) => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              />
              <canvas 
                ref={canvasRef}
                onClick={handleCanvasClick}
                width={imgSize.w} 
                height={imgSize.h}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair', pointerEvents: 'auto' }}
              />
              <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(0,0,0,0.8)', padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 800 }}>
                <span className="mega-bold-white" style={{ color: 'var(--primary)', marginRight: '8px' }}>INSTRUCTIONS:</span> <span className="mega-bold-white">Click on the video to define polygon corners. Points are auto-scaled to original resolution ({imgSize.w}x{imgSize.h}).</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="glass-card">
            <h4 className="mega-bold-white" style={{ marginBottom: '16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Camera Selection</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {cameras.map(cam => (
                <div 
                  key={cam.id} 
                  onClick={() => {setSelectedCam(cam); setPoints([])}}
                  className={`nav-item ${selectedCam?.id === cam.id ? 'active' : ''}`}
                  style={{ borderRadius: '12px', background: selectedCam?.id === cam.id ? 'var(--primary-glow)' : 'var(--glass)' }}
                >
                  <MapPin size={16} /> <span className="mega-bold-white">{cam.place_name}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedCam && (
            <div className="glass-card">
              <h4 className="mega-bold-white" style={{ marginBottom: '16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activation Settings</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <label className="mega-bold-white" style={{ flexShrink: 0 }}>Activation Time (optional):</label>
                <input 
                  type="datetime-local" 
                  value={activationTime} 
                  onChange={e => setActivationTime(e.target.value)}
                  style={{ margin: 0, flex: 1 }}
                />
              </div>

              <h4 className="mega-bold-white" style={{ marginBottom: '16px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Existing Zones in {selectedCam.place_name}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {existingZones.map(zone => (
                  <div key={zone.id} className="glass-card" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: 800 }}>Zone #{zone.id}</span>
                      <button onClick={() => handleDeleteZone(zone.id)} style={{ padding: '4px 8px', background: 'rgba(244,63,94,0.1)', color: 'var(--accent)', fontSize: '10px' }}>Remove</button>
                    </div>
                    <p className="mega-bold-white" style={{ fontSize: '10px', marginTop: '4px' }}>
                      {zone.activation_time ? `Starts: ${new Date(zone.activation_time).toLocaleString()}` : 'Always Active'}
                    </p>
                  </div>
                ))}
                {existingZones.length === 0 && <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic', fontWeight: 700 }}>No zones defined yet</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RestrictionArea;
