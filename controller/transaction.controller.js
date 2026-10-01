const mongoose = require('mongoose');
const { buildTransactionsPDF } = require('../util/pdf.util');
const {
  buildTransactionsCSV,
  parseTransactionsCSV,
  buildCSVTemplate
} = require('../util/csv.util');
const Transaction = require('../model/Transaction.model');
const Category = require('../model/Category.model');

/* -------------------------------------------------------------------------- */
/*                                HELPERS                                     */
/* -------------------------------------------------------------------------- */
/**
 * Check number is optional — no validation needed.
 * Kept as a helper for consistency and future rules.
 * @returns {null}
 */
const validateCheckNumber = () => null;

/**
 * Build Mongo filter from query params.
 * Safe for find() / countDocuments() — Mongoose auto-casts.
 */
const buildFilterFromQuery = (query) => {
  const {
    startDate,
    endDate,
    category,
    status,
    paymentMethod,
    currency,
    search,
    minAmount,
    maxAmount
  } = query;

  const filter = {};

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  /* Accept either single id or comma-separated ids */
  if (category) {
    const ids = String(category).split(',').map((s) => s.trim()).filter(Boolean);
    filter.category = ids.length > 1 ? { $in: ids } : ids[0];
  }

  if (status) filter.status = status;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (currency) filter.currency = currency;

  if (search) {
    filter.description = { $regex: search, $options: 'i' };
  }

  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }

  return filter;
};

/**
 * Convert a query filter into one safe for use in aggregate() pipelines.
 * Why: aggregate() does NOT auto-cast strings to ObjectId like find() does.
 * That's why filtering by category used to return totals of 0 in the KPI cards.
 */
const buildAggregationFilter = (query) => {
  const base = buildFilterFromQuery(query);
  const safe = { ...base };

  if (safe.category) {
    if (safe.category.$in) {
      const validIds = safe.category.$in
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validIds.length > 0) {
        safe.category = { $in: validIds };
      } else {
        delete safe.category;
      }
    } else if (mongoose.Types.ObjectId.isValid(safe.category)) {
      safe.category = new mongoose.Types.ObjectId(safe.category);
    } else {
      delete safe.category;
    }
  }

  return safe;
};

/* -------------------------------------------------------------------------- */
/*                            CREATE TRANSACTION                              */
/* -------------------------------------------------------------------------- */
const createTransaction = async (req, res) => {
  try {
    const {
      date,
      currency,
      amount,
      description,
      category,
      status,
      paymentMethod,
      checkNumber,
      receiptUrl
    } = req.body;

    /* Check number is optional — no validation */

    /* Validate category exists */
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const transaction = await Transaction.create({
      date,
      currency,
      amount,
      description,
      category,
      status,
      paymentMethod,
      checkNumber,
      receiptUrl
    });

    await transaction.populate('category', 'name color');

    return res.status(201).json({
      message: 'Transaction created successfully',
      transaction
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                          GET ALL TRANSACTIONS                              */
/* -------------------------------------------------------------------------- */
const getTransactions = async (req, res) => {
  try {
    /* Pagination */
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    /* Filters */
    const filter = buildFilterFromQuery(req.query);

    /* Sorting */
    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    /* Query */
    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter)
        .populate('category', 'name color')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter)
    ]);

    /* Totals per currency for filtered set (aggregation-safe filter) */
    const totalsAgg = await Transaction.aggregate([
      { $match: buildAggregationFilter(req.query) },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } }
    ]);

    const totals = { PKR: 0, USD: 0 };
    totalsAgg.forEach((t) => {
      totals[t._id] = t.total;
    });

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      data: transactions,
      pagination: {
        currentPage: page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      totals
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                         GET TRANSACTION BY ID                              */
/* -------------------------------------------------------------------------- */
const getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id).populate(
      'category',
      'name color'
    );

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    return res.status(200).json({ transaction });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid transaction ID' });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                           UPDATE TRANSACTION                               */
/* -------------------------------------------------------------------------- */
const updateTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    /* Check number is optional — no validation */

    /* If category changed, verify new one exists */
    if (req.body.category && String(req.body.category) !== String(transaction.category)) {
      const categoryExists = await Category.findById(req.body.category);
      if (!categoryExists) {
        return res.status(404).json({ message: 'Category not found' });
      }
    }

    const allowedFields = [
      'date',
      'currency',
      'amount',
      'description',
      'category',
      'status',
      'paymentMethod',
      'checkNumber',
      'receiptUrl'
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        transaction[field] = req.body[field];
      }
    });

    await transaction.save();
    await transaction.populate('category', 'name color');

    return res.status(200).json({
      message: 'Transaction updated successfully',
      transaction
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid transaction ID' });
    }
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                           DELETE TRANSACTION                               */
/* -------------------------------------------------------------------------- */
const deleteTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await transaction.deleteOne();

    return res.status(200).json({
      message: 'Transaction deleted successfully',
      deletedId: req.params.id
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid transaction ID' });
    }
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                          BULK DELETE                                       */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Delete multiple transactions by IDs
 * @route   DELETE /api/transactions/bulk
 * @body    { ids: ["id1", "id2", ...] }
 * @access  Private (Admin)
 */
const bulkDeleteTransactions = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }

    const result = await Transaction.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({
      message: 'Bulk delete completed',
      requested: ids.length,
      deleted: result.deletedCount
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                          MONTHLY AGGREGATION                               */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Get monthly totals grouped by currency (for charts)
 * @route   GET /api/transactions/stats/monthly?year=2025
 * @access  Private (Admin)
 */
const getMonthlyStats = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const stats = await Transaction.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            month: { $month: '$date' },
            currency: '$currency'
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.month': 1 } }
    ]);

    /* Reshape to { month, PKR, USD, count } */
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      PKR: 0,
      USD: 0,
      count: 0
    }));

    stats.forEach((s) => {
      const idx = s._id.month - 1;
      months[idx][s._id.currency] = s.total;
      months[idx].count += s.count;
    });

    return res.status(200).json({ year, months });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                         EXPORT PDF                                         */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Export transactions as a PDF report (uses the same filters as list)
 * @route   GET /api/transactions/export/pdf
 * @access  Private (Admin)
 * @query   same filters as GET /api/transactions (no pagination)
 */
const exportTransactionsPDF = async (req, res) => {
  try {
    /* Filters (reuse the same builder as list) */
    const filter = buildFilterFromQuery(req.query);

    /* Sorting (same rules as list) */
    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    /* No pagination — export the full filtered set */
    const transactions = await Transaction.find(filter)
      .populate('category', 'name color')
      .sort(sort);

    /* Totals per currency for filtered set (aggregation-safe filter) */
    const totalsAgg = await Transaction.aggregate([
      { $match: buildAggregationFilter(req.query) },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } }
    ]);

    const totals = { PKR: 0, USD: 0 };
    totalsAgg.forEach((t) => {
      totals[t._id] = t.total;
    });

    /* Hand off to the PDF builder */
    buildTransactionsPDF({
      transactions,
      totals,
      filters: req.query,
      admin: req.admin,
      res
    });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: error.message });
    }
    /* If PDF already started streaming, just kill the stream */
    res.end();
  }
};

/* -------------------------------------------------------------------------- */
/*                         EXPORT CSV                                         */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Export transactions as CSV (uses the same filters as the list)
 * @route   GET /api/transactions/export/csv
 * @access  Private (Admin)
 * @query   same filters as GET /api/transactions (no pagination)
 */
const exportTransactionsCSV = async (req, res) => {
  try {
    /* Filters */
    const filter = buildFilterFromQuery(req.query);

    /* Sorting */
    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    /* Full filtered set — no pagination for exports */
    const transactions = await Transaction.find(filter)
      .populate('category', 'name color')
      .sort(sort);

    /* Build CSV string in memory */
    const csv = buildTransactionsCSV(transactions);

    const filename = `shahid-expense-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(csv);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: error.message });
    }
    res.end();
  }
};

/* -------------------------------------------------------------------------- */
/*                         IMPORT CSV                                         */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Import transactions from a CSV string (stateless — no file saved)
 * @route   POST /api/transactions/import/csv
 * @access  Private (Admin)
 * @body    { csv: "<raw csv contents>" }
 */
const importTransactionsCSV = async (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ message: 'No CSV content provided' });
    }

    /* Parse rows */
    let rows;
    try {
      rows = parseTransactionsCSV(csv);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    if (rows.length === 0) {
      return res.status(400).json({ message: 'CSV contains no data rows' });
    }

    /* Cap the row count to prevent abuse */
    const MAX_ROWS = 10000;
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        message: `Too many rows (${rows.length}). Maximum is ${MAX_ROWS} per import.`
      });
    }

    /* Load categories once for name → _id lookup (case-insensitive) */
    const categories = await Category.find().lean();
    const categoryMap = new Map();
    categories.forEach((c) => {
      categoryMap.set(c.name.trim().toLowerCase(), c);
    });

    const valid = [];
    const errors = [];

    rows.forEach((row) => {
      const rowErrors = [];

      /* ----- Date ----- */
      const rawDate = row.date;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      if (!rawDate) {
        rowErrors.push('Date is required');
      } else if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        rowErrors.push(`Invalid date "${rawDate}"`);
      }

      /* ----- Currency ----- */
      const currency = (row.currency || '').toUpperCase();
      if (!['PKR', 'USD'].includes(currency)) {
        rowErrors.push(`Currency must be PKR or USD (got "${row.currency}")`);
      }

      /* ----- Amount ----- */
      const amountStr = String(row.amount || '').replace(/,/g, '').trim();
      const amount = Number(amountStr);
      if (!amountStr) {
        rowErrors.push('Amount is required');
      } else if (!Number.isFinite(amount) || amount <= 0) {
        rowErrors.push(`Amount must be a positive number (got "${row.amount}")`);
      }

      /* ----- Description ----- */
      const description = (row.description || '').trim();
      if (!description) {
        rowErrors.push('Description is required');
      } else if (description.length > 300) {
        rowErrors.push('Description cannot exceed 300 characters');
      }

      /* ----- Category ----- */
      const categoryName = (row.category || '').trim();
      let category = null;
      if (!categoryName) {
        rowErrors.push('Category is required');
      } else {
        category = categoryMap.get(categoryName.toLowerCase()) || null;
        if (!category) {
          rowErrors.push(`Category "${categoryName}" not found`);
        }
      }

      /* ----- Status (optional, default Pending) ----- */
      const statusRaw = (row.status || '').trim();
      const status = statusRaw || 'Pending';
      if (!['Pending', 'Completed'].includes(status)) {
        rowErrors.push(`Status must be Pending or Completed (got "${statusRaw}")`);
      }

      /* ----- Payment Method ----- */
      const paymentMethod = (row.paymentMethod || '').trim();
      if (!['Cash', 'Card', 'Check'].includes(paymentMethod)) {
        rowErrors.push(`Payment method must be Cash, Card, or Check (got "${row.paymentMethod}")`);
      }

      /* ----- Check Number (optional) ----- */
      const checkNumber = paymentMethod === 'Check' ? (row.checkNumber || '').trim() : '';

      /* ----- Receipt URL (optional) ----- */
      const receiptUrl = (row.receiptUrl || '').trim();

      if (rowErrors.length > 0) {
        errors.push({ row: row.__rowIndex, message: rowErrors.join('; ') });
        return;
      }

      valid.push({
        date: parsedDate,
        currency,
        amount,
        description,
        category: category._id,
        status,
        paymentMethod,
        checkNumber,
        receiptUrl
      });
    });

    /* Insert valid rows */
    let insertedCount = 0;
    if (valid.length > 0) {
      const inserted = await Transaction.insertMany(valid, { ordered: false });
      insertedCount = inserted.length;
    }

    return res.status(200).json({
      message: 'Import completed',
      total: rows.length,
      imported: insertedCount,
      failed: errors.length,
      errors
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                         DOWNLOAD CSV TEMPLATE                              */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Download a starter CSV template
 * @route   GET /api/transactions/import/template
 * @access  Private (Admin)
 */
const downloadCSVTemplate = (req, res) => {
  const csv = buildCSVTemplate();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="shahid-expense-template.csv"');
  return res.send(csv);
};

module.exports = {
  createTransaction,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  bulkDeleteTransactions,
  getMonthlyStats,
  exportTransactionsPDF,
  exportTransactionsCSV,
  importTransactionsCSV,
  downloadCSVTemplate
};