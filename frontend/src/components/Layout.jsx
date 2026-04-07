import React, { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Camera, ShieldAlert, LogOut, Search, Youtube, Activity, History, BellRing, AlertTriangle, Upload, UserCheck } from 'lucide-react';
import { io } from 'socket.io-client';

const Layout = ({ loggedUser, onLogout }) => {
  const [alarmActive, setAlarmActive] = useState(false);
  const [latestAlert, setLatestAlert] = useState(null);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const [uiLogs, setUiLogs] = useState([]);
  const lastAlertIdRef = useRef(localStorage.getItem('vision_last_alert_id') ? Number(localStorage.getItem('vision_last_alert_id')) : null);
  const lastVehicleIdRef = useRef(localStorage.getItem('vision_last_vehicle_id') ? Number(localStorage.getItem('vision_last_vehicle_id')) : null);
  const audioRef = useRef(null);
  const navigate = useNavigate();

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const addUiLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setUiLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10)); // Increased to 10 for better visibility
    console.log(msg);
  };

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
      addUiLog("🎵 System Beep Triggered.");
    } catch (e) {
      addUiLog("❌ Web Audio API Error.");
    }
  };

  const playSiren = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc1.type = 'sawtooth';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc2.frequency.setValueAtTime(443, audioCtx.currentTime);
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.0);

      osc1.start(); osc2.start();
      osc1.stop(audioCtx.currentTime + 2);
      osc2.stop(audioCtx.currentTime + 2);
      addUiLog("🚨 Emergency Siren Triggered.");
    } catch (e) {
      addUiLog("❌ Siren Audio Error.");
    }
  };

  useEffect(() => {
    // Initial connectivity check
    fetch('/api/alarm-sound', { method: 'HEAD' })
      .then(res => {
        if (res.ok) addUiLog("✅ Audio file connection OK.");
        else addUiLog("❌ Audio file 404/Error.");
      })
      .catch(err => addUiLog("❌ Audio Network Error."));

    // Global click listener to satisfy browser autoplay
    const unlockAudio = () => {
      if (audioRef.current) {
        audioRef.current.play()
          .then(() => {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsAudioUnlocked(true);
            addUiLog("🛡️ Audio Unlocked by Click.");
            window.removeEventListener('click', unlockAudio);
          })
          .catch(() => {});
      }
    };
    window.addEventListener('click', unlockAudio);

    const token = localStorage.getItem('vision_token');

    fetch('/api/alerts', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) onLogout();
        return res.json();
      })
      .then(data => { if (Array.isArray(data) && data.length > 0) lastAlertIdRef.current = data[0].id; });

    fetch('/api/vehicles', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) onLogout();
        return res.json();
      })
      .then(data => { if (Array.isArray(data) && data.length > 0) lastVehicleIdRef.current = data[0].id; });

    const socket = io();

    socket.on('new_alert', (newest) => {
      const currentId = Number(newest.id);
      const baselineId = lastAlertIdRef.current !== null ? Number(lastAlertIdRef.current) : null;

      // Handle database reset or bad baseline
      if (baselineId !== null && currentId < baselineId) {
        addUiLog(`📉 Alert ID reset detected (${baselineId} -> ${currentId}). Syncing...`);
        lastAlertIdRef.current = currentId;
        localStorage.setItem('vision_last_alert_id', currentId.toString());
        return;
      }

      if (baselineId !== null && currentId > baselineId) {
        addUiLog(`🚨 NEW ALERT DETECTED [ID: ${currentId} @ ${newest.camera_name}]`);
        setLatestAlert(newest);
        setAlarmActive(true);
        lastAlertIdRef.current = currentId;
        localStorage.setItem('vision_last_alert_id', currentId.toString());
        
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`🚨 SECURITY ALERT`, { body: `Violation at ${newest.camera_name}`, tag: 'alert-' + newest.id });
        }
        if (audioRef.current) audioRef.current.play().then(playSiren).catch(e => addUiLog(`🔇 Audio Play Failed: ${e.message}`));
      } else if (baselineId === null) {
        addUiLog(`✅ Monitoring Alerts (Baseline: ${currentId})`);
        lastAlertIdRef.current = currentId;
        localStorage.setItem('vision_last_alert_id', currentId.toString());
      }
    });

    socket.on('new_vehicle', (newest) => {
      const currentId = Number(newest.id);
      const baselineId = lastVehicleIdRef.current !== null ? Number(lastVehicleIdRef.current) : null;

      if (baselineId !== null && currentId > baselineId) {
        addUiLog(`🚗 VEHICLE: ${newest.camera_name} - Detected [${newest.plate_number}]`);
        lastVehicleIdRef.current = currentId;
        localStorage.setItem('vision_last_vehicle_id', currentId.toString());
        playBeep(); // Short beep for vehicles
      } else if (baselineId === null) {
        lastVehicleIdRef.current = currentId;
      }
    });

    return () => socket.disconnect();
  }, []);

  const dismissAlarm = () => {
    setAlarmActive(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const testAlarm = () => {
    console.log("🔔 Manual Alarm Test Triggered.");
    if (audioRef.current) {
      audioRef.current.volume = 1.0;
      audioRef.current.play()
        .then(() => {
          console.log("🔊 Test sound playing successfully.");
          setIsAudioUnlocked(true);
        })
        .catch(e => {
          console.error("Audio Blocked:", e);
          setIsAudioUnlocked(false);
        });
      
      // Show dummy alert for visual feedback too
      setLatestAlert({ camera_name: "TEST_MODE", timestamp: new Date(), id: -1 });
      setAlarmActive(true);
    }
  };

  return (
    <div className="app-container">
      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef} 
        src={`/api/alarm-sound?t=${Date.now()}`} 
        loop 
        preload="auto"
      />

      {/* Alarm Modal Overlay */}
      {alarmActive && (
        <div className="alarm-overlay">
          <div className="alarm-card">
            <div style={{ marginBottom: '24px' }}>
              <div style={{ width: '80px', height: '80px', background: 'rgba(244, 63, 94, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <AlertTriangle size={48} color="#f43f5e" className="pulse-red" style={{ borderRadius: '50%' }} />
              </div>
              <h2 style={{ color: '#f43f5e', fontSize: '28px', fontWeight: 800, textTransform: 'uppercase' }}>Security Breach</h2>
              <p style={{ color: '#94a3b8', marginTop: '8px', fontWeight: 700 }}>Restricted area violation detected!</p>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px', marginBottom: '32px', textAlign: 'left' }}>
              <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Camera Source</div>
              <div style={{ fontWeight: 700, fontSize: '16px' }}>{latestAlert?.camera_name || 'Unknown Camera'}</div>
              <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', marginTop: '12px', marginBottom: '4px' }}>Timestamp</div>
              <div style={{ fontWeight: 600 }}>{latestAlert?.timestamp ? new Date(latestAlert.timestamp).toLocaleTimeString() : 'Just now'}</div>
            </div>

            <button 
              onClick={dismissAlarm}
              style={{ width: '100%', height: '56px', background: '#f43f5e', color: 'white', borderRadius: '16px', fontSize: '18px', fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(244, 63, 94, 0.4)' }}
            >
              DISMISS ALARM
            </button>
            <button 
              onClick={() => { dismissAlarm(); navigate('/dashboard'); }}
              style={{ width: '100%', height: '48px', background: 'transparent', color: '#94a3b8', border: 'none', marginTop: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}
            >
              View Full Report - Analysis History
            </button>
          </div>
        </div>
      )}

      <div className="sidebar">
        <div className="logo">
          <Activity size={28} color="#6366f1" />
          <span className="mega-bold-white">V-SHIELD AI</span>
        </div>
        
        <div className="nav-group">
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={20} /> <span className="mega-bold-white">Dashboard</span>
          </NavLink>
          <NavLink to="/cameras" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Camera size={20} /> <span className="mega-bold-white">Manage Cams</span>
          </NavLink>
          <NavLink to="/viewer" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Search size={20} /> <span className="mega-bold-white">Live Viewer</span>
          </NavLink>
          <NavLink to="/zones" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ShieldAlert size={20} /> <span className="mega-bold-white">Restriction Area</span>
          </NavLink>
          <NavLink to="/youtube" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Youtube size={20} /> <span className="mega-bold-white">YouTube Monitoring</span>
          </NavLink>
          <NavLink to="/upload" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Upload size={20} /> <span className="mega-bold-white">Upload Video</span>
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <History size={20} /> <span className="mega-bold-white">Entry Logs</span>
          </NavLink>
          <NavLink to="/ppe" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <UserCheck size={20} /> <span className="mega-bold-white">PPE Monitoring</span>
          </NavLink>
          
          {/* Test Alarm / Unlock Button */}
          <div 
            onClick={testAlarm} 
            className={`nav-item ${!isAudioUnlocked ? 'pulse-border' : ''}`} 
            style={{ 
              cursor: 'pointer', 
              color: isAudioUnlocked ? '#f43f5e' : '#fbbf24', 
              borderTop: '1px solid rgba(255,255,255,0.05)', 
              marginTop: '8px', 
              paddingTop: '16px',
              fontWeight: !isAudioUnlocked ? 'bold' : 'normal'
            }}
          >
            {isAudioUnlocked ? <BellRing size={20} /> : <AlertTriangle size={20} />}
            {isAudioUnlocked ? 'Test Alarm Sound' : 'ACTIVATE ALARM AUDIO'}
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div className="nav-item" onClick={onLogout} style={{ cursor: 'pointer' }}>
            <LogOut size={20} /> <span className="mega-bold-white">Logout ({loggedUser})</span>
          </div>
        </div>
      </div>

      <div className="main-content">
        <div 
          onClick={testAlarm}
          style={{ 
            position: 'fixed', 
            top: '20px', 
            right: '20px', 
            zIndex: 1000, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px',
            background: isAudioUnlocked ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            padding: '8px 16px',
            borderRadius: '12px',
            border: `1px solid ${isAudioUnlocked ? '#10b981' : '#f59e0b'}`,
            backdropFilter: 'blur(8px)',
            animation: isAudioUnlocked ? 'none' : 'pulse-amber 2s infinite',
            cursor: 'pointer'
          }}
        >
          {isAudioUnlocked ? <BellRing size={18} color="#10b981" /> : <AlertTriangle size={18} color="#f59e0b" />}
          <span style={{ fontSize: '11px', fontWeight: 700, color: isAudioUnlocked ? '#10b981' : '#f59e0b' }}>
            ALARM: {isAudioUnlocked ? `ARMED (ID: ${lastAlertIdRef.current || '---'})` : 'MUTED (CLICK TO UNLOCK)'}
          </span>
        </div>



        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
