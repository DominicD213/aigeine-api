const express = require('express');
const { User, UserQueries } = require('../models/schema');
const OpenAI = require('openai');
require('dotenv').config({ path: './vars/.env' });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API,
});

const createRouter = (io, upload) => {
    const router = express.Router();

    // Signup route
    router.post('/signup', async (req, res) => {
        const { username, password, email } = req.body;

        try {
            const existingUser = await User.findOne({ $or: [{ username }, { email }] });

            if (existingUser) {
                return res.status(400).send('Username or email already exists');
            }

            const newUser = new User({ username, password, email });
            await newUser.save();

            return res.status(201).send('User created successfully');
        } catch (error) {
            console.error('Error creating user:', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    // Login route
    router.post('/login', async (req, res) => {
        const { username, password } = req.body;

        try {
            const user = await User.findOne({ username });

            if (!user) {
                return res.status(401).send('Username not found');
            }

            const isPasswordValid = await user.comparePassword(password);

            if (!isPasswordValid) {
                return res.status(401).send('Invalid password');
            }

            req.session.user = {
                id: user._id,
                username: user.username,
                email: user.email,
                image: user.userImage,
            };
    
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).send('Error saving session');
                }
                return res.status(200).json({
                    message: 'Login successful',
                    user: {
                        username: user.username,
                        email: user.email,
                        image: user.userImage
                    }
                });
            });


            return res.status(200).json({
                message: 'Login successful',
                user: {
                    username: user.username,
                    email: user.email,
                    image: user.imageUrl
                }
            });

        } catch (error) {
            console.error('Login error:', error);
            return res.status(500).send('Error logging in');
        }
    });

    // Session status route
    router.get('/login/session-status', (req, res) => {
        console.log('Session status route accessed');
        if (req.session.user) {
            console.log('User session found:', req.session.user);
            return res.status(200).json({ active: true, user: req.session.user });
        } else {
            console.log('No active session');
        }
    });

    // Logout route
    router.post('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).send('Error logging out');
            }
            res.clearCookie('connect.sid');
            return res.status(200).send('Logout successful');
        });
    });

    // Function to converse with ChatGPT
    async function converseWithChatGPT(query) {
        try {
            const stream = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: query }],
                stream: true,
            });

            let fullResponse = '';
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                process.stdout.write(content);
                fullResponse += content;
            }

            if (!fullResponse) {
                throw new Error('Invalid response from OpenAI');
            }

            console.log(fullResponse);
            return fullResponse;
        } catch (error) {
            console.error('Error communicating with OpenAI:', error);
            throw error;
        }
    }

    // OpenAI response route
    router.post('/login/session-status/openAIResponse', async (req, res) => {
        if (!req.session.user) {
            return res.status(401).send('Unauthorized');
        }

        try {
            const query = req.body.query;
            const response = await converseWithChatGPT(query);

            const userId = req.session.user.id;
            const newRequest = new UserQueries({
                user: userId,
                query: query,
                response: response,
            });
            await newRequest.save();

            io.emit('newQuery', { query, response });

            return res.status(200).json({ response });
        } catch (error) {
            console.error('OpenAI API error:', error);
            return res.status(500).send('Error communicating with OpenAI API');
        }
    });

    // Retrieve the most recent user queries
    router.get('/login/session-status/openAIResponse/responseQuery', async (req, res) => {
        if (!req.session.user) {
            return res.status(401).send('Unauthorized');
        }

        try {
            const userId = req.session.user.id;
            const userQueries = await UserQueries.find({ user: userId })
                .select('query response');

            return res.status(200).json(userQueries);
        } catch (error) {
            console.error('Error retrieving user queries:', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    // Search History
    router.get('/login/session-status/search/history', async (req, res) => {
        if (!req.session.user) {
            return res.status(401).send('Unauthorized');
        }
    
        try {
            const userId = req.session.user.id;
            const userSearchHistory = req.query.query;
    
            const query = { user: userId };
            if (userSearchHistory) {
                query.query = { $regex: userSearchHistory, $options: 'i' };
            }
    
            const userSearch = await UserQueries.find(query)
                .select('query response')
                .sort({ createdAt: 1 });
    
            return res.status(200).json(userSearch);
        } catch (error) {
            console.error('Error retrieving user queries:', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    // Upload image route
    router.post('/login/session-status/upload', upload.single('file'), async (req, res) => {
        if (!req.session.user) {
            return res.status(401).send('Unauthorized');
        }
    
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }
    
        console.log('Received file:', req.file);
    
        if (!global.gfs) {
            console.error('GridFS not initialized');
            return res.status(500).send('File system not initialized');
        }
    
        try {
            const { originalname, buffer } = req.file;
            console.log('Starting upload for file:', originalname);
    
            const stream = global.gfs.openUploadStream(originalname);
            stream.end(buffer);
    
            stream.on('finish', async (file) => {
                console.log('Upload finished for file:', file.filename);
    
                try {
                    const userId = req.session.user.id;
                    const user = await User.findById(userId);
                    if (!user) {
                        return res.status(404).send('User not found');
                    }
                    user.userImage = file._id;
                    await user.save();
                    console.log('User updated with image ID:', file._id);
                    res.status(201).send({ fileId: file._id });
                } catch (error) {
                    console.error('Error updating user:', error);
                    res.status(500).send('Internal Server Error');
                }
            });
    
            stream.on('error', (err) => {
                console.error('Error uploading file:', err);
                res.status(500).send('Internal Server Error');
            });
        } catch (error) {
            console.error('Error handling file upload:', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    return router;
};

module.exports = createRouter;
