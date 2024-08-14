const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
var session = require('express-session')
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { GridFSBucket } = require('mongodb');
const multer = require('multer');
const path = require('path');
const MongoStore = require('connect-mongo');
require('dotenv').config({ path: './vars/.env' });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [process.env.ORIGIN, 'http://localhost:3000'],
        methods: ["GET", "POST"]
    }
});

// CORS setup
const corsOptions = {
    origin: [process.env.ORIGIN, 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Parse JSON and URL-encoded data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const secretKey = crypto.randomBytes(32).toString('hex');

// Session setup with connect-mongo
app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.DB_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: { secure: false } // Set to true if using https
}));

// Setup multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 1000000 }, // 1MB limit
    fileFilter: (req, file, cb) => {
        if (!file || !file.originalname) {
            console.error('File or file.originalname is undefined');
            return cb(new Error('Invalid file data'), false);
        }

        // Check file type (can be customized)
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        cb(new Error('Invalid file type'));
    }
});

// Pass io and upload to the routes
const routes = require('./routes/routes')(io, upload);
app.use('/', routes);

// Connect to MongoDB
mongoose.connect(process.env.DB_URI)
    .then((conn) => {
        console.log('DB Connected');
        global.gfs = new GridFSBucket(conn.connection.db, {
            bucketName: 'images'
        });
        console.log('MongoDB connected and GridFS initialized');
    })
    .catch((err) => console.error(`DB Connection Error: ${err}`));

mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
    console.log(`Mongoose connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected from DB');
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
    console.log(`Server is active on port ${port}`);
});

io.on('connection', (socket) => {
    console.log('Socket.io connected');

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Socket.io disconnected');
    });
});
