const express = require('express');
const { register, login, getProfile, updateProfile } = require('../controllers/AuthController');
const AuthMiddleware = require('../middlewares/AuthMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', AuthMiddleware, getProfile);
router.put('/profile', AuthMiddleware, updateProfile);

module.exports = router;