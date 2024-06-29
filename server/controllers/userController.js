// server/controllers/userController.js
const User = require('../models/User');

exports.createUser = async (req, res) =>
{
    try
    {
        const user = new User(req.body);
        await user.save();
        res.status(201).json(user);
    }
    catch (error)
    {
        res.status(400).json({ error: 'Error creating user' });
    }
};

exports.getUsers = async (req, res) =>
{
    try
    {
        const users = await User.find();
        res.status(200).json(users);
    }
    catch (error)
    {
        res.status(500).json({ error: 'Error fetching users' });
    }
};

exports.updateUser = async (req, res) =>
    {
    try
    {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(user);
    }
    catch (error)
    {
        res.status(400).json({ error: 'Error updating user' });
    }
};

exports.deleteUser = async (req, res) =>
{
    try
    {
        await User.findByIdAndDelete(req.params.id);
        res.status(204).json({ message: 'User deleted' });
    }
    catch (error)
    {
        res.status(500).json({ error: 'Error deleting user' });
    }
};
