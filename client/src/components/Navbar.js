import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Navbar.css'; // Importa il file CSS per lo stile della barra di navigazione

const Navbar = () => (
    <nav className="navbar">
        <ul className="navbar-nav">
            <li className="nav-item">
                <Link to="/" className="nav-link">Home</Link>
            </li>
            <li className="nav-item">
                <Link to="/view-users" className="nav-link">Visualizza Utenti</Link>
            </li>
            <li className="nav-item">
                <Link to="/register" className="nav-link">Registre Utenti</Link>
            </li>
        </ul>
    </nav>
);

export default Navbar;
