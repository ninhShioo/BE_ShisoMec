const mysql = require('mysql2/promise');
require('dotenv').config({ quiet: true });

// Tạo kết nối pool để quản lý nhiều connections hiệu quả
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dental_clinic_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kiểm tra kết nối
pool.getConnection()
    .then((connection) => {
        console.log('Connected to MySQL database successfully!');
        connection.release();
    })
    .catch((err) => {
        console.error('Error connecting to MySQL database:', err.message);
    });

module.exports = pool;
