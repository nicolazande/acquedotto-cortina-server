const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Definizione dello schema utente
const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: false,
            unique: true,
            sparse: true,
            trim: true,
        },
        numero_telefono: {
            type: String,
            required: false,
            unique: true,
            sparse: true,
        },
        role: {
            type: String,
            enum: ['admin', 'cliente'],
            default: 'admin',
        },
        cliente: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Cliente',
            required: false,
        },
        active: {
            type: Boolean,
            default: true,
        },
    },
    {
        collection: 'utenti', // Collection name in the database
    }
);

// Ricerca dell'account portale a partire dal cliente.
userSchema.index({ role: 1, cliente: 1 });

// Pre-save hook per criptare la password
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Metodo per confrontare la password inserita con quella memorizzata nel database
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Creazione del modello utente
const User = mongoose.model('User', userSchema);

module.exports = User;
