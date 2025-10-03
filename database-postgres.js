// PostgreSQL setup for Render hosting
const { Pool } = require('pg');

class PostgreSQLAdapter {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    async init() {
        try {
            // Create tables if they don't exist
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS submissions (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR,
                    email VARCHAR,
                    phone VARCHAR,
                    service VARCHAR,
                    message TEXT,
                    preferred_date VARCHAR,
                    preferred_time VARCHAR,
                    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ip VARCHAR
                )
            `);

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS bookings (
                    id VARCHAR PRIMARY KEY,
                    details JSONB,
                    amount DECIMAL,
                    status VARCHAR,
                    payment_intent_id VARCHAR,
                    paid_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS admin_users (
                    id BIGINT PRIMARY KEY,
                    email VARCHAR UNIQUE,
                    username VARCHAR,
                    password_hash VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS chats (
                    client_id VARCHAR PRIMARY KEY,
                    client_info JSONB,
                    messages JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS analytics_events (
                    id SERIAL PRIMARY KEY,
                    event_type VARCHAR,
                    data JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            console.log('✅ PostgreSQL database initialized');
        } catch (error) {
            console.error('❌ PostgreSQL initialization failed:', error);
        }
    }

    // Submissions
    async getSubmissions() {
        const result = await this.pool.query('SELECT * FROM submissions ORDER BY submitted_at DESC');
        return result.rows;
    }

    async addSubmission(submission) {
        const query = `
            INSERT INTO submissions (id, name, email, phone, service, message, preferred_date, preferred_time, submitted_at, ip)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
        await this.pool.query(query, [
            submission.id, submission.name, submission.email, submission.phone,
            submission.service, submission.message, submission.preferred_date,
            submission.preferred_time, submission.submitted_at, submission.ip
        ]);
    }

    // Bookings
    async getBookings() {
        const result = await this.pool.query('SELECT * FROM bookings ORDER BY created_at DESC');
        return result.rows;
    }

    async addBooking(booking) {
        const query = `
            INSERT INTO bookings (id, details, amount, status, payment_intent_id, paid_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await this.pool.query(query, [
            booking.id, JSON.stringify(booking.details), booking.amount,
            booking.status, booking.paymentIntentId, booking.paidAt,
            booking.createdAt, booking.updatedAt
        ]);
    }

    async updateBooking(bookingId, updates) {
        const setClause = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`).join(', ');
        const values = [bookingId, ...Object.values(updates)];
        await this.pool.query(`UPDATE bookings SET ${setClause} WHERE id = $1`, values);
    }

    // Admin Users
    async getAdminUsers() {
        const result = await this.pool.query('SELECT * FROM admin_users');
        return result.rows;
    }

    async addAdminUser(user) {
        const query = `
            INSERT INTO admin_users (id, email, username, password_hash, created_at)
            VALUES ($1, $2, $3, $4, $5)
        `;
        await this.pool.query(query, [
            user.id, user.email, user.username, user.password_hash, user.created_at
        ]);
    }

    async updateAdminUser(userId, updates) {
        const setClause = Object.keys(updates).map((key, index) => `${key} = $${index + 2}`).join(', ');
        const values = [userId, ...Object.values(updates)];
        await this.pool.query(`UPDATE admin_users SET ${setClause} WHERE id = $1`, values);
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgreSQLAdapter;

