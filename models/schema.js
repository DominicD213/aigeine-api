const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Schema } = mongoose;

// User schema definition
const userSchema = new Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    userImage: { type: mongoose.Schema.Types.ObjectId, ref: 'fs.files' }, 
    entryDate: { type: Date, default: Date.now }
});

// Pre-save hook for hashing passwords
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// UserQueries schema definition
const userQueriesSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    query: { type: String, required: true },
    response: { type: String, required: true },
});

// Model definitions
const User = mongoose.model('User', userSchema, 'Users');
const UserQueries = mongoose.model('UserQueries', userQueriesSchema, 'user_queries');

module.exports = { User, UserQueries };
