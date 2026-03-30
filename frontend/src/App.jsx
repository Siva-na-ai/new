import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Activity, Search, Lock } from 'lucide-react'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import CamerasView from './components/CamerasView'
import RestrictionArea from './components/RestrictionArea'
import YoutubeView from './components/YoutubeView'
import EntryLogs from './components/EntryLogs'
import UploadView from './components/UploadView'
import PPELogs from './components/PPELogs'
import DetectionHistory from './components/DetectionHistory'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem('vision_auth') === 'true');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loggedUser, setLoggedUser] = useState(localStorage.getItem('vision_user') || '');

  const handleLogin = (e) => {
    e.preventDefault();
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    .then(res => {
      if (res.ok) return res.json();
      throw new Error('Security Alert: Access denied. Please verify your credentials or contact system support.');
    })
    .then(data => {
      localStorage.setItem('vision_auth', 'true');
      localStorage.setItem('vision_user', data.username);
      setIsLoggedIn(true);
      setLoggedUser(data.username);
    })
    .catch(err => {
      alert(err.message);
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('vision_auth');
    localStorage.removeItem('vision_user');
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return (
      <div className="modal-overlay" style={{ background: 'var(--bg-dark)' }}>
        <div className="glass-card modal-content" style={{ width: '400px', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '20px', background: 'var(--primary-glow)', marginBottom: '16px' }}>
              <Activity size={40} color="var(--primary)" />
            </div>
            <h1 className="logo" style={{ justifyContent: 'center', fontSize: '28px' }}>V-SHIELD AI</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '14px', marginTop: '8px' }}>Surveillance & Analytics Suite</p>
          </div>
          
          <form style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} onSubmit={handleLogin}>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: '16px', top: '16px', color: 'var(--text-dim)' }} />
              <input 
                type="text" 
                placeholder="Username" 
                style={{ paddingLeft: '48px' }}
                value={username} 
                onChange={(e) => setUsername(e.target.value)} 
              />
            </div>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '16px', top: '16px', color: 'var(--text-dim)' }} />
              <input 
                type="password" 
                placeholder="Password" 
                style={{ paddingLeft: '48px' }}
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
              />
            </div>
            <button type="submit" style={{ marginTop: '16px', height: '50px', fontSize: '16px' }}>
              Enter Workspace
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '12px', color: 'var(--text-dim)' }}>
            Protected by VisionGate AI Security
          </p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout loggedUser={loggedUser} onLogout={handleLogout} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/cameras" element={<CamerasView />} />
          <Route path="/viewer" element={<CamerasView isViewer />} />
          <Route path="/zones" element={<RestrictionArea />} />
          <Route path="/youtube" element={<YoutubeView />} />
          <Route path="/upload" element={<UploadView />} />
          <Route path="/logs" element={<EntryLogs />} />
          <Route path="/ppe" element={<PPELogs />} />
          <Route path="/detections" element={<DetectionHistory />} />
        </Route>
        {/* Redirect unknown routes */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
