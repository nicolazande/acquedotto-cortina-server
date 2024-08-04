const express = require('express');
const { register, login, getProfile } = require('../controllers/AuthController');
const AuthMiddleware = require('../middlewares/AuthMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', AuthMiddleware, getProfile);

module.exports = router;