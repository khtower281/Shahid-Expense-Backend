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

  if (category) {
    const ids = String(category).split(',').map((s) => s.trim()).filter(Boolean);
    filter.category = ids.length > 1 ? { $in: ids } : ids[0];
  }

  if (status) filter.status = status;

  if (paymentMethod) {
    /* Normalize display spelling to stored value */
    filter.paymentMethod = paymentMethod === 'Cheque' ? 'Check' : paymentMethod;
  }

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
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const filter = buildFilterFromQuery(req.query);

    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter)
        .populate('category', 'name color')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter)
    ]);

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
const getMonthlyStats = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const stats = await Transaction.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { month: { $month: '$date' }, currency: '$currency' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.month': 1 } }
    ]);

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
/*                     CATEGORY BREAKDOWN (aggregated)                        */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Aggregated totals grouped by category — full filtered set
 * @route   GET /api/transactions/stats/by-category
 * @access  Private (Admin)
 */
const getCategoryBreakdown = async (req, res) => {
  try {
    const match = buildAggregationFilter(req.query);

    const rows = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]);

    const ids = rows.map((r) => r._id).filter(Boolean);
    const cats = await Category.find({ _id: { $in: ids } }).lean();
    const catMap = new Map(cats.map((c) => [String(c._id), c]));

    const data = rows.map((r) => {
      const c = catMap.get(String(r._id));
      return {
        categoryId: r._id || null,
        name: c?.name || 'Uncategorized',
        color: c?.color || '#94a3b8',
        total: r.total,
        count: r.count
      };
    });

    return res.status(200).json({ data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                   PAYMENT METHOD BREAKDOWN (aggregated)                    */
/* -------------------------------------------------------------------------- */
/**
 * @desc    Aggregated totals grouped by payment method — full filtered set
 * @route   GET /api/transactions/stats/by-method
 * @access  Private (Admin)
 */
const getPaymentMethodBreakdown = async (req, res) => {
  try {
    const match = buildAggregationFilter(req.query);

    const rows = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const data = rows.map((r) => ({
      method: r._id || 'Unknown',
      total: r.total,
      count: r.count
    }));

    return res.status(200).json({ data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                         EXPORT PDF                                         */
/* -------------------------------------------------------------------------- */
const exportTransactionsPDF = async (req, res) => {
  try {
    const filter = buildFilterFromQuery(req.query);

    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const transactions = await Transaction.find(filter)
      .populate('category', 'name color')
      .sort(sort);

    const totalsAgg = await Transaction.aggregate([
      { $match: buildAggregationFilter(req.query) },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } }
    ]);

    const totals = { PKR: 0, USD: 0 };
    totalsAgg.forEach((t) => {
      totals[t._id] = t.total;
    });

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
    res.end();
  }
};

/* -------------------------------------------------------------------------- */
/*                         EXPORT CSV                                         */
/* -------------------------------------------------------------------------- */
const exportTransactionsCSV = async (req, res) => {
  try {
    const filter = buildFilterFromQuery(req.query);

    const allowedSortFields = ['date', 'amount', 'createdAt', 'updatedAt'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'date';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const transactions = await Transaction.find(filter)
      .populate('category', 'name color')
      .sort(sort);

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
const importTransactionsCSV = async (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ message: 'No CSV content provided' });
    }

    let rows;
    try {
      rows = parseTransactionsCSV(csv);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    if (rows.length === 0) {
      return res.status(400).json({ message: 'CSV contains no data rows' });
    }

    const MAX_ROWS = 10000;
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        message: `Too many rows (${rows.length}). Maximum is ${MAX_ROWS} per import.`
      });
    }

    const categories = await Category.find().lean();
    const categoryMap = new Map();
    categories.forEach((c) => categoryMap.set(c.name.trim().toLowerCase(), c));

    const valid = [];
    const errors = [];

    rows.forEach((row) => {
      const rowErrors = [];

      const rawDate = row.date;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      if (!rawDate) {
        rowErrors.push('Date is required');
      } else if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        rowErrors.push(`Invalid date "${rawDate}"`);
      }

      const currency = (row.currency || '').toUpperCase();
      if (!['PKR', 'USD'].includes(currency)) {
        rowErrors.push(`Currency must be PKR or USD (got "${row.currency}")`);
      }

      const amountStr = String(row.amount || '').replace(/,/g, '').trim();
      const amount = Number(amountStr);
      if (!amountStr) {
        rowErrors.push('Amount is required');
      } else if (!Number.isFinite(amount) || amount <= 0) {
        rowErrors.push(`Amount must be a positive number (got "${row.amount}")`);
      }

      const description = (row.description || '').trim();
      if (!description) {
        rowErrors.push('Description is required');
      } else if (description.length > 300) {
        rowErrors.push('Description cannot exceed 300 characters');
      }

      const categoryName = (row.category || '').trim();
      let category = null;
      if (!categoryName) {
        rowErrors.push('Category is required');
      } else {
        category = categoryMap.get(categoryName.toLowerCase()) || null;
        if (!category) rowErrors.push(`Category "${categoryName}" not found`);
      }

      const statusRaw = (row.status || '').trim();
      const status = statusRaw || 'Pending';
      if (!['Pending', 'Completed'].includes(status)) {
        rowErrors.push(`Status must be Pending or Completed (got "${statusRaw}")`);
      }

      let paymentMethod = (row.paymentMethod || '').trim();
      if (paymentMethod.toLowerCase() === 'cheque') paymentMethod = 'Check';
      if (!['Cash', 'Card', 'Check'].includes(paymentMethod)) {
        rowErrors.push(`Payment method must be Cash, Card, or Cheque (got "${row.paymentMethod}")`);
      }

      const checkNumber = paymentMethod === 'Check' ? (row.checkNumber || '').trim() : '';
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
  getCategoryBreakdown,
  getPaymentMethodBreakdown,
  exportTransactionsPDF,
  exportTransactionsCSV,
  importTransactionsCSV,
  downloadCSVTemplate
};