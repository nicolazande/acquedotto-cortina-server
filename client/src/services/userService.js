// client/src/services/userService.js
import axios from 'axios';

export const registerUser = async (userData) => {
    try {
        const response = await axios.post('/api/users/add', userData);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const fetchUsers = async () => {
    try {
        const response = await axios.get('/api/users');
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const updateUser = async (id, userData) => {
    try {
        const response = await axios.put(`/api/users/${id}`, userData);
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const deleteUser = async (id) => {
    try {
        const response = await axios.delete(`/api/users/${id}`);
        return response.data;
    } catch (error) {
        throw error;
    }
};
