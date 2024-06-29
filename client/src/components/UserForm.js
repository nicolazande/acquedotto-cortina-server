// client/src/components/UserForm.js
import React, { useState } from 'react';
import axios from 'axios';

const UserForm = () => {
    const [name, setName] = useState('');
    const [surname, setSurname] = useState('');
    const [phone, setPhone] = useState('');
    const [meterReading, setMeterReading] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post('/api/users/add', {
                name,
                surname,
                phone,
                meterReading
            });
            alert('User registered successfully');
            setName('');
            setSurname('');
            setPhone('');
            setMeterReading('');
        } catch (error) {
            alert('Error registering user');
        }
    };

    return (
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
                Phone:
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </label>
            <label>
                Meter Reading:
                <input type="text" value={meterReading} onChange={(e) => setMeterReading(e.target.value)} required />
            </label>
            <button type="submit">Register User</button>
        </form>
    );
};

export default UserForm;
