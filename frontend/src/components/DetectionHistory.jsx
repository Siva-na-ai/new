import React, { useState, useEffect } from 'react';
import { Search, Calendar, Film, Shield, MapPin, Tag } from 'lucide-react';

const DetectionHistory = () => {
    const [logs, setLogs] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchLogs = () => {
        setLoading(true);
        let url = '/api/detections';
        const params = [];
        if (startDate) params.push(`start_date=${startDate}`);
        if (endDate) params.push(`end_date=${endDate}`);
        if (params.length) url += '?' + params.join('&');

        fetch(url)
            .then(res => res.json())
            .then(data => {
                setLogs(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: '24px' }}>Detection History</h2>
                    <p style={{ color: 'var(--text-dim)' }}>Archived AI detection logs and security events</p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--glass)', padding: '4px 12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <Calendar size={16} color="var(--primary)" />
                        <input 
                            type="date" 
                            value={startDate} 
                            onChange={e => setStartDate(e.target.value)}
                            style={{ background: 'transparent', border: 'none', marginBottom: 0, padding: '8px 4px', width: '130px', fontSize: '13px' }}
                        />
                        <span style={{ color: 'var(--text-dim)' }}>to</span>
                        <input 
                            type="date" 
                            value={endDate} 
                            onChange={e => setEndDate(e.target.value)}
                            style={{ background: 'transparent', border: 'none', marginBottom: 0, padding: '8px 4px', width: '130px', fontSize: '13px' }}
                        />
                    </div>
                    <button onClick={fetchLogs} disabled={loading} style={{ height: '42px' }}>
                        {loading ? '...' : <Search size={18} />}
                    </button>
                </div>
            </header>

            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ margin: 0 }}>
                    <thead>
                        <tr>
                            <th style={{ paddingLeft: '28px' }}>Event Preview</th>
                            <th>Timestamp</th>
                            <th>Location</th>
                            <th>Class Detected</th>
                            <th>Confidence</th>
                            <th style={{ paddingRight: '28px' }}>Secure ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length === 0 ? (
                            <tr>
                                <td colSpan="6" style={{ textAlign: 'center', padding: '100px', color: 'var(--text-dim)' }}>
                                    No detection logs found for this period.
                                </td>
                            </tr>
                        ) : logs.map(log => (
                            <tr key={log.id}>
                                <td style={{ paddingLeft: '28px' }}>
                                    {log.image_data ? (
                                        <div style={{ width: '100px', height: '60px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                            <img src={`data:image/jpeg;base64,${log.image_data}`} alt="Detection" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </div>
                                    ) : (
                                        <div style={{ width: '100px', height: '60px', borderRadius: '8px', background: 'var(--glass)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Film size={20} opacity={0.3} />
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div style={{ fontWeight: 600 }}>{new Date(log.timestamp).toLocaleDateString()}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <MapPin size={14} color="var(--primary)" />
                                        <span>{log.camera_name || `Cam ${log.camera_id}`}</span>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Tag size={14} color="var(--success)" />
                                        <span style={{ textTransform: 'capitalize' }}>{log.class_name?.replace('_', ' ')}</span>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ width: '60px', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', marginBottom: '4px' }}>
                                        <div style={{ width: `${log.confidence * 100}%`, height: '100%', background: 'var(--success)', borderRadius: '3px' }}></div>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{(log.confidence * 100).toFixed(1)}% Match</div>
                                </td>
                                <td style={{ paddingRight: '28px' }}>
                                    <div style={{ 
                                        display: 'flex', alignItems: 'center', gap: '6px', 
                                        fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-dim)',
                                        background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: '6px'
                                    }}>
                                        <Shield size={12} />
                                        <span>{log.metadata_hash?.substring(0, 12)}...</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DetectionHistory;
