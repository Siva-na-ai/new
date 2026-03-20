import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Camera, ShieldAlert, LogOut, Plus, MapPin, Search, Youtube, Activity, History, Lock } from 'lucide-react'
import Dashboard from './components/Dashboard'
import CamerasView from './components/CamerasView'
import RestrictionArea from './components/RestrictionArea'
import YoutubeView from './components/YoutubeView'
import EntryLogs from './components/EntryLogs'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem('vision_auth') === 'true');
  const [activeTab, setActiveTab] = useState('dashboard');
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
    <div className="app-container">
      <div className="sidebar">
        <div className="logo">
          <Activity size={28} color="#6366f1" />
          <span>V-SHIELD AI</span>
        </div>
        
        <div className="nav-group">
          <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <LayoutDashboard size={20} /> Dashboard
          </div>
          <div className={`nav-item ${activeTab === 'cameras' ? 'active' : ''}`} onClick={() => setActiveTab('cameras')}>
            <Camera size={20} /> Manage Cams
          </div>
          <div className={`nav-item ${activeTab === 'view' ? 'active' : ''}`} onClick={() => setActiveTab('view')}>
            <Search size={20} /> Live Viewer
          </div>
          <div className={`nav-item ${activeTab === 'zones' ? 'active' : ''}`} onClick={() => setActiveTab('zones')}>
            <ShieldAlert size={20} /> Restriction Area
          </div>
          <div className={`nav-item ${activeTab === 'youtube' ? 'active' : ''}`} onClick={() => setActiveTab('youtube')}>
            <Youtube size={20} /> YouTube Monitoring
          </div>
          <div className={`nav-item ${activeTab === 'entry_logs' ? 'active' : ''}`} onClick={() => setActiveTab('entry_logs')}>
            <History size={20} /> Entry Logs
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div className="nav-item" onClick={() => {
            localStorage.removeItem('vision_auth');
            localStorage.removeItem('vision_user');
            setIsLoggedIn(false);
          }}>
            <LogOut size={20} /> Logout ({loggedUser})
          </div>
        </div>
      </div>

      <div className="main-content">
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'cameras' && <CamerasView />}
        {activeTab === 'view' && <CamerasView isViewer />}
        {activeTab === 'zones' && <RestrictionArea />}
        {activeTab === 'youtube' && <YoutubeView />}
        {activeTab === 'entry_logs' && <EntryLogs />}
      </div>
    </div>
  );
}

export default App;
