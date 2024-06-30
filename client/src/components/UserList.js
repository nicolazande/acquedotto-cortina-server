// client/src/components/UserList.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const UserList = () => {
    const [users, setUsers] = useState([]);
    const [map, setMap] = useState(null);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await axios.get('/api/users');
                setUsers(response.data);
                initializeMap(response.data);
            } catch (error) {
                alert('Error fetching users');
            }
        };

        fetchUsers();
    }, []);

    const handleDelete = async (userId) => {
        try {
            await axios.delete(`/api/users/${userId}`);
            setUsers(users.filter((user) => user._id !== userId));
            alert('User deleted successfully');
            initializeMap(users.filter((user) => user._id !== userId));
        } catch (error) {
            alert('Error deleting user');
        }
    };

    const initializeMap = (users) => {
        if (!map) {
            const mapInstance = L.map('map').setView([46.5396, 12.1357], 10);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstance);
            setMap(mapInstance);
        } else {
            map.eachLayer((layer) => {
                if (layer instanceof L.Marker) {
                    map.removeLayer(layer);
                }
            });
        }

        users.forEach((user) => {
            if (user.position) {
                L.marker([user.position.lat, user.position.lng]).addTo(map)
                    .bindPopup(`${user.name} ${user.surname}`);
            }
        });
    };

    return (
        <div>
            <h2>Registered Users</h2>
            <ul>
                {users.map((user) => (
                    <li key={user._id}>
                        {user.name} {user.surname} - {user.email} - {user.phone} - {user.meterReading}
                        <button onClick={() => handleDelete(user._id)}>Delete</button>
                    </li>
                ))}
            </ul>
            <div id="map" style={{ height: '500px', width: '100%' }}></div>
        </div>
    );
};

export default UserList;
