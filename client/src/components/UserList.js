import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/UserList.css'; // Importiamo il file CSS per la tabella

const UserList = () => {
    const [users, setUsers] = useState([]);
    const [selectedFile, setSelectedFile] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const mapRef = useRef(null); // Riferimento per la mappa

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const response = await axios.get('/api/users');
                setUsers(response.data);
            } catch (error) {
                alert('Error fetching users');
            }
        };

        fetchUsers();
    }, []);

    useEffect(() => {
        if (mapRef.current === null) {
            const mapInstance = L.map('map').setView([46.5396, 12.1357], 10);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstance);
            mapRef.current = mapInstance;
        }
        initializeMap(users);
    }, [users]);

    const handleDelete = async (userId) => {
        try {
            await axios.delete(`/api/users/${userId}`);
            setUsers((prevUsers) => prevUsers.filter((user) => user._id !== userId));
            alert('User deleted successfully');
        } catch (error) {
            alert('Error deleting user');
        }
    };

    const handleViewFile = (filePath) => {
        setSelectedFile(filePath);
        setIsModalOpen(true);
    };

    const initializeMap = (users) => {
        const map = mapRef.current;
        if (map) {
            // Rimuovi tutti i marker esistenti
            map.eachLayer((layer) => {
                if (layer instanceof L.Marker) {
                    map.removeLayer(layer);
                }
            });

            // Aggiungi nuovi marker
            users.forEach((user) => {
                if (user.position) {
                    L.marker([user.position.lat, user.position.lng], { icon: L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }) }).addTo(map)
                        .bindPopup(`${user.name} ${user.surname}`);
                }
            });
        }
    };

    return (
        <div className="user-list-container">
            <div id="map" className="user-map"></div>
            <div className="user-table-container">
                <h2>Registered Users</h2>
                <table className="user-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Surname</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Meter Reading</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr key={user._id}>
                                <td>{user.name}</td>
                                <td>{user.surname}</td>
                                <td>{user.email}</td>
                                <td>{user.phone}</td>
                                <td>{user.meterReading}</td>
                                <td>
                                    <button className="delete-button" onClick={() => handleDelete(user._id)}>
                                        Delete
                                    </button>
                                    {user.filePath && (
                                        <button className="view-file-button" onClick={() => handleViewFile(user.filePath)}>
                                            View File
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && selectedFile && (
                <div className="modal">
                    <div className="modal-content">
                        <span className="close" onClick={() => setIsModalOpen(false)}>&times;</span>
                        {selectedFile.endsWith('.pdf') ? (
                            <embed src={selectedFile} type="application/pdf" width="100%" height="600px" />
                        ) : (
                            <img src={selectedFile} alt="User uploaded file" style={{ width: '100%' }} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserList;
