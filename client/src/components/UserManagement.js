// client/src/components/UserManagement.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [name, setName] = useState('');
    const [surname, setSurname] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [meterReading, setMeterReading] = useState('');
    const [meterImage, setMeterImage] = useState(null);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const response = await axios.get('/api/users');
            setUsers(response.data);
        } catch (error) {
            alert('Error fetching users');
        }
    };

    const handleSubmit = async (e) => {
        //e.preventDefault();
        try {
            const response = await axios.post('/api/users/add', {
                name,
                surname,
                email,
                phone,
                meterReading,
                meterImage
            });
            alert('User registered successfully');
            setName('');
            setSurname('');
            setEmail('');
            setPhone('');
            setMeterReading('');
            setMeterImage(null);
            fetchUsers(); // Refresh the user list
        } catch (error) {
            alert('Error registering user');
        }
    };

    const handleDelete = async (userId) => {
        try {
            await axios.delete(`/api/users/${userId}`);
            setUsers(users.filter((user) => user._id !== userId));
            alert('User deleted successfully');
        } catch (error) {
            alert('Error deleting user');
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
                <label>
                    Meter Image:
                    <input type="file" onChange={(e) => setMeterImage(e.target.files[0])} required />
                </label>
                <button type="submit">Register User</button>
            </form>
            <h2>Registered Users</h2>
            <ul>
                {users.map((user) => (
                    <li key={user._id}>
                        {user.name} {user.surname} - {user.email} - {user.phone} - {user.meterReading}
                        <button onClick={() => handleDelete(user._id)}>Delete</button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default UserManagement;
