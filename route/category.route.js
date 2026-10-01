const express = require('express');
const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
} = require('../controller/category.controller');
const protect = require('../middleware/auth.middleware');

const router = express.Router();

/* All category routes are protected — admin must be logged in */
router.use(protect);

/* POST   /api/categories       → create */
router.post('/', createCategory);

/* GET    /api/categories       → list all */
router.get('/', getCategories);

/* GET    /api/categories/:id   → get one */
router.get('/:id', getCategoryById);

/* PUT    /api/categories/:id   → update */
router.put('/:id', updateCategory);

/* DELETE /api/categories/:id   → delete */
router.delete('/:id', deleteCategory);

module.exports = router;