// server/server.js
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const port = process.env.PORT || 5000;

// Connect to the database
connectDB();

app.use(cors());
app.use(express.json());

// Define routes
const userRouter = require('./routes/userRoutes');
app.use('/api/users', userRouter);

app.listen(port, () =>
{
    console.log(`Server is running on port: ${port}`);
});
