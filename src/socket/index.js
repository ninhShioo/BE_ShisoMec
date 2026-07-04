const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { getCorsOrigins } = require('../config/env');
const { setSocketServer } = require('./emitter');
const chatController = require('../controllers/chat.controller');
const { ASSISTANT_NAME, buildAssistantResponse, getAssistantSenderId } = require('../services/chatAssistant.service');
const { createNotification, createNotificationsForRoles } = require('../services/notification.service');

const staffChatNotificationTitle = 'Khach can ho tro chat';

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

                if ((socket.user.role === 'staff' || socket.user.role === 'admin') && receiverId) {
                    await createNotification(
                        pool,
                        receiverId,
                        'Tin nhan moi tu phong kham',
                        `${socket.user.fullName}: ${message.slice(0, 120)}`,
                        'chat'
                    );
                }

                if (socket.user.role === 'patient') {
                    const assistantSenderId = await getAssistantSenderId();
                    if (!assistantSenderId) return;

                    io.to(`chat:patient:${patientRoomId}`).emit('assistant_typing', { typing: true });

                    const response = await buildAssistantResponse(message, { patientId: socket.user.id, user: socket.user });
                    if (!response?.message) return;
                    const metadata = JSON.stringify(response.metadata || {});

                    if (response.needsStaff) {
                        await pool.query(
                            `UPDATE ChatConversations
                             SET needsStaff = 1,
                                 priorityReason = ?,
                                 status = IF(status = "closed", "open", status),
                                 updatedAt = CURRENT_TIMESTAMP
                             WHERE patientId = ?`,
                            [response.priorityReason || 'Cần nhân viên hỗ trợ.', socket.user.id]
                        );

                        const [recentNotifications] = await pool.query(
                            `SELECT id
                             FROM Notifications
                             WHERE type = "chat"
                               AND title = ?
                               AND message LIKE ?
                               AND createdAt >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                             LIMIT 1`,
                            [staffChatNotificationTitle, `%${socket.user.fullName}%`]
                        );

                        if (recentNotifications.length === 0) {
                            await createNotificationsForRoles(
                                pool,
                                ['staff', 'admin'],
                                staffChatNotificationTitle,
                                `${socket.user.fullName} cần nhân viên hỗ trợ qua chat. ${response.priorityReason || ''}`.trim(),
                                'chat'
                            );
                        }
                    }

                    const [assistantResult] = await pool.query(
                        `INSERT INTO ChatMessages (senderId, receiverId, message, isAssistant, assistantName, metadata, readAt)
                         VALUES (?, ?, ?, 1, ?, ?, ?)`,
                        [assistantSenderId, socket.user.id, response.message, ASSISTANT_NAME, metadata, null]
                    );

                    const assistantPayload = {
                        id: assistantResult.insertId,
                        senderId: assistantSenderId,
                        receiverId: socket.user.id,
                        senderName: ASSISTANT_NAME,
                        role: 'assistant',
                        message: response.message,
                        isAssistant: 1,
                        metadata,
                        createdAt: new Date()
                    };

                    io.to(`chat:patient:${patientRoomId}`).emit('assistant_typing', { typing: false });
                    io.to(`chat:patient:${patientRoomId}`).emit('receive_message', assistantPayload);
                    io.to('chat:staff').emit('receive_message', {
                        ...assistantPayload,
                        patientId: patientRoomId,
                        needsStaff: response.needsStaff,
                        priorityReason: response.priorityReason
                    });
                }
            } catch (error) {
                console.error('Socket send_message error:', error.message);
                if (socket.user.role === 'patient') {
                    io.to(`chat:patient:${socket.user.id}`).emit('assistant_typing', { typing: false });
                }
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
