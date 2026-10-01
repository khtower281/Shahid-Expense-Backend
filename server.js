require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db.config');
const authRoute = require('./route/auth.route');
const categoryRoute = require('./route/category.route');
const transactionRoute = require('./route/transaction.route');

const app = express();

/* -------------------- Middleware -------------------- */
app.use(cors());
app.use(express.json({ limit: '5mb' }));

/* -------------------- Routes -------------------- */
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Shahid Expense API' });
});

app.use('/api/auth', authRoute);
app.use('/api/categories', categoryRoute);
app.use('/api/transactions', transactionRoute);

/* -------------------- 404 Handler -------------------- */
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

/* -------------------- Boot -------------------- */
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});