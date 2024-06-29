// client/src/components/Navbar.js
import React from 'react';
import { Link } from 'react-router-dom';

const Navbar = () => (
    <nav>
        <ul>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/register">Register User</Link></li>
            <li><Link to="/view-users">View Users</Link></li>
        </ul>
    </nav>
);

export default Navbar;
