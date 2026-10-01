const express = require('express');
const {
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
} = require('../controller/transaction.controller');
const protect = require('../middleware/auth.middleware');

const router = express.Router();

/* All routes protected */
router.use(protect);

/* POST   /api/transactions              → create */
router.post('/', createTransaction);

/* GET    /api/transactions              → list */
router.get('/', getTransactions);

/* GET    /api/transactions/stats/monthly?year=2025 → monthly totals */
router.get('/stats/monthly', getMonthlyStats);

/* GET    /api/transactions/export/pdf   → download filtered PDF report */
router.get('/export/pdf', exportTransactionsPDF);

/* GET    /api/transactions/export/csv   → download filtered CSV */
router.get('/export/csv', exportTransactionsCSV);

/* GET    /api/transactions/import/template → download CSV template */
router.get('/import/template', downloadCSVTemplate);

/* POST   /api/transactions/import/csv   → import transactions from CSV */
router.post('/import/csv', importTransactionsCSV);

/* DELETE /api/transactions/bulk         → bulk delete */
router.delete('/bulk', bulkDeleteTransactions);

/* GET    /api/transactions/:id          → get one */
router.get('/:id', getTransactionById);

/* PUT    /api/transactions/:id          → update */
router.put('/:id', updateTransaction);

/* DELETE /api/transactions/:id          → delete */
router.delete('/:id', deleteTransaction);

module.exports = router;