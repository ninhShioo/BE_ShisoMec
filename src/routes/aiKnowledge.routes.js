const express = require('express');
const router = express.Router();
const aiKnowledgeController = require('../controllers/aiKnowledge.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

router.use(verifyToken, checkRole(['admin']));

router.get('/training-samples', aiKnowledgeController.getTrainingSamples);
router.get('/feedback-summary', aiKnowledgeController.getFeedbackSummary);
router.post('/validate', aiKnowledgeController.validateCandidate);
router.patch('/training-samples/:id', logActivity('UPDATE_AI_TRAINING_SAMPLE', 'AiTrainingSamples'), aiKnowledgeController.updateTrainingSample);
router.post('/training-samples/:id/promote', logActivity('PROMOTE_AI_TRAINING_SAMPLE', 'AiTrainingSamples'), aiKnowledgeController.promoteTrainingSample);
router.get('/', aiKnowledgeController.getAll);
router.post('/', logActivity('CREATE_AI_KNOWLEDGE', 'AiKnowledge'), aiKnowledgeController.create);
router.put('/:id', logActivity('UPDATE_AI_KNOWLEDGE', 'AiKnowledge'), aiKnowledgeController.update);
router.delete('/:id', logActivity('DELETE_AI_KNOWLEDGE', 'AiKnowledge'), aiKnowledgeController.delete);

module.exports = router;
