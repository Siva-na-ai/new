import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

const NotificationContext = createContext();

export const useNotification = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const showNotification = useCallback((message, type = 'success') => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message, type }]);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  }, []);

  const removeNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      
      {/* Toaster UI */}
      <div style={{
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        pointerEvents: 'none'
      }}>
        {notifications.map((n) => (
          <div 
            key={n.id}
            className="glass-card"
            style={{
              pointerEvents: 'auto',
              minWidth: '320px',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              background: 'rgba(15, 23, 42, 0.95)',
              border: `1.5px solid ${n.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
              boxShadow: `0 10px 40px -10px rgba(0,0,0,0.5), 0 0 20px -5px ${n.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`,
              animation: 'toastIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              borderRadius: '20px',
              backdropFilter: 'blur(20px)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {n.type === 'success' ? (
                <CheckCircle size={22} color="var(--success)" />
              ) : (
                <AlertTriangle size={22} color="var(--accent)" />
              )}
              <span style={{ 
                fontSize: '14px', 
                fontWeight: 700, 
                color: '#fff',
                letterSpacing: '-0.01em'
              }}>
                {n.message}
              </span>
            </div>
            <button 
              onClick={() => removeNotification(n.id)}
              style={{
                background: 'transparent',
                padding: '4px',
                borderRadius: '8px',
                color: 'var(--text-dim)',
                boxShadow: 'none'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(50px) scale(0.9); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </NotificationContext.Provider>
  );
};
