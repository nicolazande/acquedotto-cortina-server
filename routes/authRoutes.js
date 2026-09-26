const express = require('express');
const { login, getProfile, updateProfile, healthCheck } = require('../controllers/AuthController');
const AuthMiddleware = require('../middlewares/AuthMiddleware');
const { rateLimitLogin } = require('../middlewares/RateLimitMiddleware');

const router = express.Router();

router.get('/health', healthCheck);
router.post('/login', rateLimitLogin, login);
router.get('/profile', AuthMiddleware, getProfile);
router.put('/profile', AuthMiddleware, updateProfile);

module.exports = router;