let ioInstance = null;

const setSocketServer = (io) => {
    ioInstance = io;
};

const getSocketServer = () => ioInstance;

const emitToUser = (userId, event, payload) => {
    if (!ioInstance || !userId) return;
    ioInstance.to(`user:${userId}`).emit(event, payload);
};

const emitToRole = (role, event, payload) => {
    if (!ioInstance || !role) return;
    ioInstance.to(`role:${role}`).emit(event, payload);
};

const emitToRoles = (roles, event, payload) => {
    roles.forEach((role) => emitToRole(role, event, payload));
};

module.exports = {
    setSocketServer,
    getSocketServer,
    emitToUser,
    emitToRole,
    emitToRoles
};
