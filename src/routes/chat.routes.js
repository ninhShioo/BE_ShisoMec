const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);

router.get('/contacts', chatController.getContacts);
router.get('/history', chatController.getChatHistory);
router.delete('/history', chatController.clearChatHistory);
router.post('/messages/:id/feedback', chatController.submitMessageFeedback);
router.put('/conversations/:patientId', chatController.updateConversation);

module.exports = router;
