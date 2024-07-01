import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/UserList.css'; // Importiamo il file CSS per la tabella

const UserList = () => {
    const [users, setUsers] = useState([]);
    const [selectedFile, setSelectedFile] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState(null); // Stato per l'utente selezionato
    const [modalContentSize, setModalContentSize] = useState({ width: '60%', height: '80%' }); // Dimensioni contenuto modale
    const mapRef = useRef(null); // Riferimento per la mappa
    const tableRef = useRef(null); // Riferimento per la tabella
    const markersRef = useRef([]); // Riferimento per i marker sulla mappa
    const highlightedMarkerRef = useRef(null); // Riferimento per il marker evidenziato

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
    }, []);

    useEffect(() => {
        initializeMap();
    }, [users]);

    const initializeMap = () => {
        const map = mapRef.current;
        if (map) {
            // Rimuovi tutti i marker esistenti
            markersRef.current.forEach((marker) => {
                map.removeLayer(marker);
            });

            // Aggiungi nuovi marker
            const newMarkers = users.map((user) => {
                if (user.position) {
                    const marker = L.marker([user.position.lat, user.position.lng], { 
                        icon: L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }) 
                    }).addTo(map)
                      .bindPopup(`${user.name} ${user.surname}`);

                    marker.user = user; // Salva il riferimento all'utente nell'oggetto marker
                    
                    marker.on('click', () => {
                        handleMarkerClick(marker); // Gestisci il clic su un marker
                    });

                    return marker;
                }
                return null;
            });

            markersRef.current = newMarkers.filter((marker) => marker !== null);
        }
    };

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

    const handleMarkerClick = (marker) => {
        const { _id } = marker.user;
        setSelectedUserId(_id); // Aggiorna l'utente selezionato

        // Scorrere fino alla riga della tabella
        scrollToUserRow(_id);

        // Centrare la mappa sul marker
        mapRef.current.setView(marker.getLatLng(), 12);

        // Evidenzia il marker sulla mappa
        highlightMarker(marker);
    };

    const scrollToUserRow = (userId) => {
        const userRow = document.getElementById(userId);
        if (userRow) {
            userRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    const handleTableRowClick = (userId) => {
        markersRef.current.forEach((marker) => {
            if (marker.user._id === userId) {
                handleMarkerClick(marker);
            }
        });
    };

    const highlightMarker = (marker) => {
        if (highlightedMarkerRef.current) {
            // Rimuovi l'evidenziazione dal marker precedente
            highlightedMarkerRef.current.setIcon(L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }));
        }

        // Evidenzia il nuovo marker
        marker.setIcon(L.icon({ iconUrl: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png' }));
        highlightedMarkerRef.current = marker;
    };

    const closeModal = () => {
        setSelectedFile(null);
        setIsModalOpen(false);
    };

    const calculateModalSize = () => {
        const width = window.innerWidth > 800 ? '60%' : '95%'; // Esempio di calcolo basato sulla larghezza della finestra
        const height = window.innerHeight > 600 ? '80%' : '95%'; // Esempio di calcolo basato sull'altezza della finestra
        setModalContentSize({ width, height });
    };

    useEffect(() => {
        window.addEventListener('resize', calculateModalSize);
        return () => window.removeEventListener('resize', calculateModalSize);
    }, []);

    return (
        <div className="user-list-container">
            <div id="map" className="user-map"></div>
            <div className="user-table-container">
                <table className="user-table" ref={tableRef}>
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Cognome</th>
                            <th>Email</th>
                            <th>Telefono</th>
                            <th>Lettura contatore</th>
                            <th>Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr
                                key={user._id}
                                id={user._id}
                                className={user._id === selectedUserId ? 'highlight' : ''}
                                onClick={() => handleTableRowClick(user._id)}
                            >
                                <td>{user.name}</td>
                                <td>{user.surname}</td>
                                <td>{user.email}</td>
                                <td>{user.phone}</td>
                                <td>{user.meterReading}</td>
                                <td>
                                    <button className="delete-button" onClick={() => handleDelete(user._id)}>
                                        Cancella
                                    </button>
                                    {user.filePath && (
                                        <button className="view-file-button" onClick={() => handleViewFile(user.filePath)}>
                                            Visualizza File
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && selectedFile && (
                <div className="modal" onClick={closeModal}>
                    <div className="modal-content" style={{ width: modalContentSize.width, height: modalContentSize.height }}>
                        <span className="close" onClick={() => setIsModalOpen(false)}>&times;</span>
                        {selectedFile.endsWith('.pdf') ? (
                            <embed src={selectedFile} type="application/pdf" width="100%" height="100%" />
                        ) : (
                            <img src={selectedFile} alt="User uploaded file" style={{ width: '100%', height: '100%' }} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserList;
