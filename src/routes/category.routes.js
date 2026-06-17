const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/category.controller');
const { verifyToken, checkRole } = require('../middlewares/auth.middleware');
const logActivity = require('../middlewares/activityLogger');

// Public
router.get('/', categoryController.getAllCategories);

// Admin only
router.post('/', verifyToken, checkRole(['admin']), logActivity('CREATE_CATEGORY', 'Categories'), categoryController.createCategory);
router.put('/:id', verifyToken, checkRole(['admin']), logActivity('UPDATE_CATEGORY', 'Categories'), categoryController.updateCategory);
router.delete('/:id', verifyToken, checkRole(['admin']), logActivity('DELETE_CATEGORY', 'Categories'), categoryController.deleteCategory);

module.exports = router;
