const Category = require('../model/Category.model');
const Transaction = require('../model/Transaction.model');

/* -------------------------------------------------------------------------- */
/*                              CREATE CATEGORY                               */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Create a new category
 * @route   POST /api/categories
 * @access  Private (Admin)
 */
const createCategory = async (req, res) => {
  try {
    const { name, description, color, isActive } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    // Check duplicate name (case-insensitive)
    const existing = await Category.findOne({
      name: { $regex: `^${name}$`, $options: 'i' }
    });

    if (existing) {
      return res.status(409).json({ message: 'Category with this name already exists' });
    }

    const category = await Category.create({
      name,
      description,
      color,
      isActive
    });

    return res.status(201).json({
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                             GET ALL CATEGORIES                             */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Get all categories
 * @route   GET /api/categories
 * @access  Private (Admin)
 * @query   isActive=true|false  (optional)
 */
const getCategories = async (req, res) => {
  try {
    const filter = {};

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const categories = await Category.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      count: categories.length,
      categories
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                             GET CATEGORY BY ID                             */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Get single category by ID
 * @route   GET /api/categories/:id
 * @access  Private (Admin)
 */
const getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    return res.status(200).json({ category });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                             UPDATE CATEGORY                                */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Update a category
 * @route   PUT /api/categories/:id
 * @access  Private (Admin)
 */
const updateCategory = async (req, res) => {
  try {
    const { name, description, color, isActive } = req.body;

    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // If name changed, check it doesn't clash with another category
    if (name && name.toLowerCase() !== category.name.toLowerCase()) {
      const existing = await Category.findOne({
        name: { $regex: `^${name}$`, $options: 'i' },
        _id: { $ne: category._id }
      });

      if (existing) {
        return res.status(409).json({ message: 'Another category with this name already exists' });
      }
    }

    if (name !== undefined) category.name = name;
    if (description !== undefined) category.description = description;
    if (color !== undefined) category.color = color;
    if (isActive !== undefined) category.isActive = isActive;

    const updated = await category.save();

    return res.status(200).json({
      message: 'Category updated successfully',
      category: updated
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                             DELETE CATEGORY                                */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Delete a category (blocked if linked transactions exist)
 * @route   DELETE /api/categories/:id
 * @access  Private (Admin)
 */
const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    /* Block delete if any transactions reference this category */
    const linkedCount = await Transaction.countDocuments({ category: category._id });

    if (linkedCount > 0) {
      return res.status(409).json({
        message: `Cannot delete "${category.name}" — it is used by ${linkedCount} transaction${
          linkedCount === 1 ? '' : 's'
        }. Deactivate it instead, or reassign those transactions first.`,
        linkedCount,
        categoryId: category._id,
        code: 'CATEGORY_IN_USE'
      });
    }

    await category.deleteOne();

    return res.status(200).json({
      message: 'Category deleted successfully',
      deletedId: req.params.id
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid category ID' });
    }
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory
};