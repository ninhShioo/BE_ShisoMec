const uploadController = {
    uploadSingle: (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Không tìm thấy file upload.' });
            }

            res.json({
                success: true,
                message: 'Upload file thành công.',
                data: {
                    url: req.file.path,
                    filename: req.file.filename
                }
            });
        } catch (error) {
            next(error);
        }
    },

    uploadMultiple: (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, message: 'Không tìm thấy file upload.' });
            }

            const files = req.files.map((file) => ({
                url: file.path,
                filename: file.filename
            }));

            res.json({
                success: true,
                message: 'Upload danh sách file thành công.',
                data: files
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = uploadController;
