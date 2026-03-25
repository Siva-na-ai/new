import React, { useState } from 'react';
import { Upload, Film, Check, Trash2, Play, Search } from 'lucide-react';

const UploadView = () => {
    const [uploading, setUploading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [placeName, setPlaceName] = useState('');

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        fetch('/api/upload-video', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            setUploading(false);
            if (data.status === 'success') {
                setUploadedFile(data);
                setPlaceName(file.name.split('.')[0]);
            } else {
                alert('Upload failed: ' + data.message);
            }
        })
        .catch(err => {
            setUploading(false);
            console.error('Upload Fetch Error:', err);
            alert('Upload error: ' + err.message + '. Please check if the server is running and the file is not too large.');
        });
    };

    const handleCreateCamera = () => {
        if (!uploadedFile || !placeName) return;

        // Default detections: person, person_not_working, forklift (Indexes 2, 12, 3)
        const detections = "2,3,12";
        const url = `/api/cameras?ip_address=${encodeURIComponent(uploadedFile.path)}&place_name=${encodeURIComponent(placeName)}&detections=${detections}`;

        fetch(url, { method: 'POST' })
            .then(res => res.json())
            .then(() => {
                alert(`Success! "${placeName}" is now being analyzed.`);
                setUploadedFile(null);
                setPlaceName('');
            });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto' }}>
            <header>
                <h2 style={{ fontSize: '24px' }}>Video Analysis Upload</h2>
                <p style={{ color: 'var(--text-dim)' }}>Upload local security footage for deep AI inspection</p>
            </header>

            <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
                {!uploadedFile ? (
                    <>
                        <div style={{ 
                            width: '100px', height: '100px', background: 'rgba(99, 102, 241, 0.1)', 
                            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' 
                        }}>
                            <Upload size={48} color="var(--primary)" />
                        </div>
                        <h3 style={{ fontSize: '20px', marginBottom: '8px' }}>Select Surveillance Footage</h3>
                        <p style={{ color: 'var(--text-dim)', marginBottom: '32px' }}>Supported formats: .mp4, .avi, .mkv (Max 500MB recommended)</p>
                        
                        <input 
                            type="file" 
                            accept="video/*" 
                            onChange={handleFileUpload} 
                            id="upload-btn" 
                            style={{ display: 'none' }} 
                        />
                        <label 
                            htmlFor="upload-btn" 
                            className="btn-primary" 
                            style={{ 
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '12px',
                                padding: '16px 32px', borderRadius: '12px', background: 'var(--primary)', color: 'white'
                            }}
                        >
                            {uploading ? 'Processing Data...' : 'Choose File from Disk'}
                        </label>
                    </>
                ) : (
                    <div style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid var(--success)' }}>
                            <Film color="var(--success)" />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700 }}>{uploadedFile.filename}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>File successfully staged on server.</div>
                            </div>
                            <Check size={20} color="var(--success)" />
                        </div>

                        <label style={{ fontSize: '13px', marginBottom: '4px', display: 'block' }}>Surveillance Point Name</label>
                        <input 
                            type="text" 
                            value={placeName} 
                            onChange={e => setPlaceName(e.target.value)} 
                            placeholder="e.g. Loading Dock B - 2024-03-20"
                            style={{ marginBottom: '24px' }}
                        />

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={handleCreateCamera} style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <Play size={18} /> START ANALYSIS NOW
                            </button>
                            <button onClick={() => setUploadedFile(null)} style={{ flex: 1, background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent)', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="glass-card" style={{ padding: '24px', background: 'rgba(99, 102, 241, 0.05)' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--primary)' }}>
                    <Search size={16} /> Analysis Capabilities
                </h4>
                <ul style={{ fontSize: '13px', color: 'var(--text-dim)', paddingLeft: '20px', lineHeight: '1.6' }}>
                    <li>Object Detection: Forklifts, Boxes, Trucks, Helmets, Vests</li>
                    <li>Security: Restricted Zone Violations & Intrusion Detection</li>
                    <li>Global ReID: Identify people across different parts of the video</li>
                    <li>Plate Reading: Automatic OCR for vehicle entry/exit</li>
                </ul>
            </div>
        </div>
    );
};

export default UploadView;
