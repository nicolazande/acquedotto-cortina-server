// userController.js

const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configurazione Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

exports.upload = upload.single('file');

exports.createUser = async (req, res) => {
    try {
        const { name, surname, email, phone, meterReading, position } = req.body;
        const user = new User({
            name,
            surname,
            email,
            phone,
            meterReading,
            position: JSON.parse(position)
        });

        if (req.file) {
            user.filePath = req.file.path;
        }

        await user.save();
        res.status(201).json(user);
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: 'Error creating user' });
    }
};

exports.getUsers = async (req, res) => {
    try {
        const users = await User.find();
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(user);
    } catch (error) {
        res.status(400).json({ error: 'Error updating user' });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Rimuovi il file associato se presente
        if (user.filePath) {
            const filePath = path.join(__dirname, '..', user.filePath);
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error(`Errore nella rimozione del file: ${err}`);
                }

                res.status(204).json({ message: 'User and associated file deleted' });
            });
        } else {
            res.status(204).json({ message: 'User deleted' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error deleting user' });
    }
};
