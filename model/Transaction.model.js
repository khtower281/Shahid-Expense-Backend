const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now
    },
    currency: {
      type: String,
      required: [true, 'Currency is required'],
      enum: {
        values: ['PKR', 'USD'],
        message: 'Currency must be PKR or USD'
      }
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters']
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required']
    },
    status: {
      type: String,
      enum: {
        values: ['Pending', 'Completed'],
        message: 'Status must be Pending or Completed'
      },
      default: 'Pending'
    },
    paymentMethod: {
      type: String,
      required: [true, 'Payment method is required'],
      enum: {
        values: ['Cash', 'Card', 'Check'],
        message: 'Payment method must be Cash, Card, or Check'
      }
    },
    checkNumber: {
      type: String,
      trim: true,
      default: ''
    },
    receiptUrl: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { timestamps: true }
);

/* -------------------- Indexes -------------------- */
transactionSchema.index({ date: -1 });
transactionSchema.index({ category: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });

/* -------------------- Pre-save normalization -------------------- */
/* Check number is optional — no validation. Only clear it when
   the payment method is not Check, to keep data tidy. */
transactionSchema.pre('save', function () {
  if (this.paymentMethod !== 'Check') {
    this.checkNumber = '';
  }
});

module.exports = mongoose.model('Transaction', transactionSchema);