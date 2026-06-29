const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { getCorsOrigins } = require('../config/env');
const { setSocketServer } = require('./emitter');
const chatController = require('../controllers/chat.controller');

const initSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: getCorsOrigins(),
            methods: ['GET', 'POST']
        }
    });

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) {
                return next(new Error('Authentication error: Token is required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const [users] = await pool.query(
                'SELECT id, fullName, email, role, status FROM Users WHERE id = ? LIMIT 1',
                [decoded.id]
            );

            if (users.length === 0) {
                return next(new Error('Authentication error: User not found'));
            }

            const user = users[0];
            if (user.status !== 'active') {
                return next(new Error('Authentication error: User is inactive'));
            }

            socket.user = {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                role: user.role
            };

            next();
        } catch (error) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.user.fullName} (${socket.user.role}) - ${socket.id}`);
        socket.join(`user:${socket.user.id}`);
        socket.join(`role:${socket.user.role}`);
        if (socket.user.role === 'patient') {
            socket.join(`chat:patient:${socket.user.id}`);
        }
        if (socket.user.role === 'staff' || socket.user.role === 'admin') {
            socket.join('chat:staff');
        }

        socket.on('send_message', async (data) => {
            try {
                const message = String(data?.message || '').trim();
                if (!message) return;

                let receiverId = data?.receiverId ? Number(data.receiverId) : null;
                let patientRoomId = socket.user.role === 'patient' ? socket.user.id : receiverId;

                if ((socket.user.role === 'staff' || socket.user.role === 'admin') && (!Number.isInteger(receiverId) || receiverId <= 0)) {
                    socket.emit('chat_error', { message: 'Vui lòng chọn khách hàng để nhắn tin.' });
                    return;
                }

                if (socket.user.role === 'patient') {
                    receiverId = null;
                    patientRoomId = socket.user.id;
                }

                await chatController.ensureConversation(
                    pool,
                    patientRoomId,
                    socket.user.role === 'staff' || socket.user.role === 'admin' ? socket.user.id : null
                );

                const [result] = await pool.query(
                    'INSERT INTO ChatMessages (senderId, receiverId, message, readAt) VALUES (?, ?, ?, ?)',
                    [socket.user.id, receiverId, message, null]
                );

                const payload = {
                    id: result.insertId,
                    senderId: socket.user.id,
                    receiverId,
                    senderName: socket.user.fullName,
                    role: socket.user.role,
                    message,
                    createdAt: new Date()
                };

                io.to(`chat:patient:${patientRoomId}`).emit('receive_message', payload);
                io.to('chat:staff').emit('receive_message', { ...payload, patientId: patientRoomId });
            } catch (error) {
                console.error('Socket send_message error:', error.message);
            }
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.user.fullName}`);
        });
    });

    setSocketServer(io);
    return io;
};

module.exports = initSocket;
