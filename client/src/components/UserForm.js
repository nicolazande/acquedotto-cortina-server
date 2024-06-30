// client/src/components/UserForm.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const UserForm = () => {
    const [name, setName] = useState('');
    const [surname, setSurname] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [meterReading, setMeterReading] = useState('');
    const [position, setPosition] = useState(null);
    const [map, setMap] = useState(null);
    const [marker, setMarker] = useState(null);

    useEffect(() => {
        if (!map) {
            const mapInstance = L.map('map').setView([46.5396, 12.1357], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstance);

            mapInstance.on('click', (e) => {
                setPosition(e.latlng);
                if (marker) {
                    mapInstance.removeLayer(marker);
                }
                const newMarker = L.marker(e.latlng, { icon: L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }) }).addTo(mapInstance);
                setMarker(newMarker);
            });

            setMap(mapInstance);
        }
    }, [map, marker]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post('/api/users/add', {
                name,
                surname,
                email,
                phone,
                meterReading,
                position
            });
            alert('User registered successfully');
            setName('');
            setSurname('');
            setEmail('');
            setPhone('');
            setMeterReading('');
            setPosition(null);
            if (marker) {
                map.removeLayer(marker);
            }
        } catch (error) {
            alert('Error registering user');
        }
    };

    return (
        <div>
            <form onSubmit={handleSubmit}>
                <label>
                    Name:
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                    Surname:
                    <input type="text" value={surname} onChange={(e) => setSurname(e.target.value)} required />
                </label>
                <label>
                    Email:
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                    Phone:
                    <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                </label>
                <label>
                    Meter Reading:
                    <input type="text" value={meterReading} onChange={(e) => setMeterReading(e.target.value)} required />
                </label>
                <div id="map" style={{ height: '400px', width: '100%' }}></div>
                <button type="submit">Register User</button>
            </form>
        </div>
    );
};

export default UserForm;
