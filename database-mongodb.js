// MongoDB setup for Render hosting
const { MongoClient } = require('mongodb');

class MongoDBAdapter {
    constructor() {
        this.client = null;
        this.db = null;
        this.collections = {
            submissions: 'submissions',
            bookings: 'bookings',
            chats: 'chats',
            admin_users: 'admin_users',
            analytics_events: 'analytics_events'
        };
    }

    async connect() {
        try {
            const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://username:password@cluster.mongodb.net/ajkcleaning';
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('ajkcleaning');
            console.log('✅ Connected to MongoDB Atlas');
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error);
            return false;
        }
    }

    async getCollection(collectionName) {
        if (!this.db) await this.connect();
        return this.db.collection(this.collections[collectionName] || collectionName);
    }

    // Submissions
    async getSubmissions() {
        const collection = await this.getCollection('submissions');
        return await collection.find({}).toArray();
    }

    async addSubmission(submission) {
        const collection = await this.getCollection('submissions');
        return await collection.insertOne(submission);
    }

    // Bookings
    async getBookings() {
        const collection = await this.getCollection('bookings');
        return await collection.find({}).toArray();
    }

    async addBooking(booking) {
        const collection = await this.getCollection('bookings');
        return await collection.insertOne(booking);
    }

    async updateBooking(bookingId, updates) {
        const collection = await this.getCollection('bookings');
        return await collection.updateOne({ id: bookingId }, { $set: updates });
    }

    // Admin Users
    async getAdminUsers() {
        const collection = await this.getCollection('admin_users');
        return await collection.find({}).toArray();
    }

    async addAdminUser(user) {
        const collection = await this.getCollection('admin_users');
        return await collection.insertOne(user);
    }

    async updateAdminUser(userId, updates) {
        const collection = await this.getCollection('admin_users');
        return await collection.updateOne({ id: userId }, { $set: updates });
    }

    // Chats
    async getChats() {
        const collection = await this.getCollection('chats');
        return await collection.find({}).toArray();
    }

    async addChat(chatId, chatData) {
        const collection = await this.getCollection('chats');
        return await collection.insertOne({ _id: chatId, ...chatData });
    }

    async updateChat(chatId, updates) {
        const collection = await this.getCollection('chats');
        return await collection.updateOne({ _id: chatId }, { $set: updates });
    }

    // Analytics
    async getAnalyticsEvents() {
        const collection = await this.getCollection('analytics_events');
        return await collection.find({}).toArray();
    }

    async addAnalyticsEvent(event) {
        const collection = await this.getCollection('analytics_events');
        return await collection.insertOne(event);
    }

    async close() {
        if (this.client) {
            await this.client.close();
        }
    }
}

module.exports = MongoDBAdapter;
