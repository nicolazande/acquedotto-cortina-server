const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { JWT_SECRET } = require('../config/auth');

// Health check route
const healthCheck = (req, res) => {
    const isDatabaseConnected = mongoose.connection.readyState === 1;
    res.status(isDatabaseConnected ? 200 : 503).json({
        status: isDatabaseConnected ? 'ok' : 'degraded',
        database: isDatabaseConnected ? 'connected' : 'disconnected',
    });
};

// Register a new user
const register = async (req, res) => {
    const { username, password } = req.body;
    try {
        const userCount = await User.countDocuments();
        console.log('[Register] Current user count:', userCount);

        if (userCount >= 2) {
            return res.status(403).json({ error: 'Registrazione disabilitata, limite utenti.' });
        }

        const user = new User({ username, password });
        await user.save();

        res.status(201).json({ message: 'Utente registrato correttamente' });
    } catch (error) {
        console.error('[Register] Error during registration:', error.message);
        res.status(400).json({ error: 'Error registering user' });
    }
};

// Login an existing user
const login = async (req, res) => {
    const { username, password } = req.body;
    try {
        console.log('[Login] Attempting login for:', username);

        const user = await User.findOne({ username });
        if (!user) {
            console.warn('[Login] User not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isPasswordValid = await user.comparePassword(password);

        if (!isPasswordValid) {
            console.warn('[Login] Invalid password for:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error) {
        console.error('[Login] Error logging in:', error.message);
        res.status(400).json({ error: 'Error logging in' });
    }
};

// Get user profile
const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            numero_telefono: user.numero_telefono,
        });
    } catch (error) {
        console.error('[GetProfile] Error fetching profile:', error.message);
        res.status(400).json({ error: 'Error fetching profile' });
    }
};

// Update user profile
const updateProfile = async (req, res) => {
    const { username, password, email, numero_telefono } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update fields; password will be hashed by pre('save') hook
        if (username) user.username = username;
        if (password) user.password = password;
        if (email) user.email = email;
        if (numero_telefono) user.numero_telefono = numero_telefono;

        await user.save();

        res.json({
            message: 'Profile updated successfully',
            updatedFields: { username, email, numero_telefono },
        });
    } catch (error) {
        console.error('[UpdateProfile] Error updating profile:', error.message);
        res.status(400).json({ error: 'Error updating profile' });
    }
};


module.exports = { register, login, getProfile, updateProfile, healthCheck };
