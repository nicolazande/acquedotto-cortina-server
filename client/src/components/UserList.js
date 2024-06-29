// client/src/components/UserList.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const UserList = () => {
    const [users, setUsers] = useState([]);

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
            <h2>Registered Users</h2>
            <ul>
                {users.map((user) => (
                    <li key={user._id}>
                        {user.name} {user.surname} - {user.phone} - {user.meterReading}
                        <button onClick={() => handleDelete(user._id)}>Delete</button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default UserList;
