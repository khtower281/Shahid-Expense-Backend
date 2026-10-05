const express = require('express');
const {
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
} = require('../controller/transaction.controller');
const protect = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protect);

router.post('/', createTransaction);
router.get('/', getTransactions);
router.get('/stats/monthly', getMonthlyStats);
router.get('/stats/by-category', getCategoryBreakdown);
router.get('/stats/by-method', getPaymentMethodBreakdown);
router.get('/export/pdf', exportTransactionsPDF);
router.get('/export/csv', exportTransactionsCSV);
router.get('/import/template', downloadCSVTemplate);
router.post('/import/csv', importTransactionsCSV);
router.delete('/bulk', bulkDeleteTransactions);
router.get('/:id', getTransactionById);
router.put('/:id', updateTransaction);
router.delete('/:id', deleteTransaction);

module.exports = router;