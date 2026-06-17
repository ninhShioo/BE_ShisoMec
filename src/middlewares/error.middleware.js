const multer = require('multer');

const sendError = (res, statusCode, message, details) => {
    res.status(statusCode).json({
        success: false,
        message,
        ...(details ? { details } : {})
    });
};

const notFoundHandler = (req, res) => {
    sendError(res, 404, 'Không tìm thấy API được yêu cầu.');
};

const errorHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    if (process.env.NODE_ENV === 'development') {
        console.error(err);
    } else {
        console.error(err.message);
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return sendError(res, 400, 'Dữ liệu JSON không hợp lệ.');
    }

    if (err.type === 'entity.too.large') {
        return sendError(res, 413, 'Dữ liệu gửi lên quá lớn.');
    }

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return sendError(res, 400, 'File upload không được vượt quá 5MB.');
        }

        if (err.code === 'LIMIT_FILE_COUNT') {
            return sendError(res, 400, 'Số lượng file upload vượt quá giới hạn cho phép.');
        }

        return sendError(res, 400, 'Dữ liệu upload không hợp lệ.');
    }

    if (err.code === 'ER_DUP_ENTRY') {
        return sendError(res, 409, 'Dữ liệu đã tồn tại.');
    }

    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
        return sendError(res, 400, 'Dữ liệu liên kết không hợp lệ hoặc đang được sử dụng.');
    }

    if (err.message && err.message.includes('Chỉ hỗ trợ upload')) {
        return sendError(res, 400, err.message);
    }

    if (err.message && err.message.includes('Multipart')) {
        return sendError(res, 400, 'Dữ liệu upload không hợp lệ. Vui lòng gửi form-data đúng định dạng.');
    }

    return sendError(
        res,
        err.statusCode || err.status || 500,
        err.statusCode || err.status ? err.message : 'Lỗi server nội bộ.',
        process.env.NODE_ENV === 'development' ? err.message : undefined
    );
};

module.exports = {
    errorHandler,
    notFoundHandler
};
