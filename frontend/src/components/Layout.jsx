import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Camera, ShieldAlert, LogOut, Search, Youtube, Activity, History } from 'lucide-react';

const Layout = ({ loggedUser, onLogout }) => {
  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="logo">
          <Activity size={28} color="#6366f1" />
          <span>V-SHIELD AI</span>
        </div>
        
        <div className="nav-group">
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={20} /> Dashboard
          </NavLink>
          <NavLink to="/cameras" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Camera size={20} /> Manage Cams
          </NavLink>
          <NavLink to="/viewer" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Search size={20} /> Live Viewer
          </NavLink>
          <NavLink to="/zones" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ShieldAlert size={20} /> Restriction Area
          </NavLink>
          <NavLink to="/youtube" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Youtube size={20} /> YouTube Monitoring
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <History size={20} /> Entry Logs
          </NavLink>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div className="nav-item" onClick={onLogout} style={{ cursor: 'pointer' }}>
            <LogOut size={20} /> Logout ({loggedUser})
          </div>
        </div>
      </div>

      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
