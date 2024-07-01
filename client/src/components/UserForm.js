import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/UserForm.css';

const UserForm = () => {
    const [name, setName] = useState('');
    const [surname, setSurname] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [meterReading, setMeterReading] = useState('');
    const [position, setPosition] = useState(null);
    const [map, setMap] = useState(null);
    const [marker, setMarker] = useState(null);
    const [file, setFile] = useState(null);

    const mapRef = useRef(null); // Reference to map instance
    const markerRef = useRef(null); // Reference to marker instance

    useEffect(() => {
        if (!mapRef.current) {
            const mapInstance = L.map('map').setView([46.5396, 12.1357], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstance);

            mapInstance.on('click', handleMapClick);

            mapRef.current = mapInstance;
            setMap(mapInstance);
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
            }
        };
    }, []); // Run only once on component mount

    const handleMapClick = (e) => {
        const clickedPosition = e.latlng;
        setPosition(clickedPosition);

        // Remove previous marker if exists
        if (markerRef.current) {
            mapRef.current.removeLayer(markerRef.current);
        }

        // Add new marker at clicked position
        const newMarker = L.marker(clickedPosition, {
            icon: L.icon({
                iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
            })
        }).addTo(mapRef.current);

        markerRef.current = newMarker; // Update marker reference
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('name', name);
        formData.append('surname', surname);
        formData.append('email', email);
        formData.append('phone', phone);
        formData.append('meterReading', meterReading);
        formData.append('position', JSON.stringify(position));
        if (file) {
            formData.append('file', file);
        }

        try {
            const response = await axios.post('/api/users', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            alert('User registered successfully');
            setName('');
            setSurname('');
            setEmail('');
            setPhone('');
            setMeterReading('');
            setPosition(null);
            setFile(null);

            // Remove marker from map
            if (markerRef.current) {
                mapRef.current.removeLayer(markerRef.current);
                markerRef.current = null; // Clear marker reference
            }
        } catch (error) {
            alert('Error registering user');
        }
    };

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    return (
        <div className="user-form-container">
            <form onSubmit={handleSubmit}>
                <div className="form-section">
                    <div className="form-field">
                        <label>Nome:</label>
                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div className="form-field">
                        <label>Cognome:</label>
                        <input type="text" value={surname} onChange={(e) => setSurname(e.target.value)} required />
                    </div>
                </div>
                <div className="form-section">
                    <div className="form-field">
                        <label>Email:</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-field">
                        <label>Telefono:</label>
                        <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                    </div>
                </div>
                <div className="form-section">
                    <div className="form-field">
                        <label>Lettura contatore:</label>
                        <input type="text" value={meterReading} onChange={(e) => setMeterReading(e.target.value)} required />
                    </div>
                    <div className="form-field file-field">
                        <label>Pianta:</label>
                        <input type="file" onChange={handleFileChange} />
                    </div>
                </div>
                <div id="map" className="user-map"></div>
                <div className="button-container">
                    <button type="submit">Registra utente</button>
                </div>
            </form>
        </div>
    );
};

export default UserForm;
