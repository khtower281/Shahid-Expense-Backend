const { parse } = require('csv-parse/sync');

const CSV_HEADERS = [
  'Date',
  'Currency',
  'Amount',
  'Description',
  'Category',
  'Status',
  'Payment Method',
  'Cheque Number',
  'Receipt URL'
];

const HEADER_TO_KEY = {
  'Date': 'date',
  'Currency': 'currency',
  'Amount': 'amount',
  'Description': 'description',
  'Category': 'category',
  'Status': 'status',
  'Payment Method': 'paymentMethod',
  'Cheque Number': 'checkNumber',
  'Receipt URL': 'receiptUrl'
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDateFriendly = (d) => {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

const formatAmount = (n) => Number(n || 0).toFixed(2);

const escapeCell = (value) => {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const buildTransactionsCSV = (transactions) => {
  const lines = [];
  lines.push(CSV_HEADERS.map(escapeCell).join(','));

  transactions.forEach((t) => {
    const payment =
      t.paymentMethod === 'Check' ? 'Cheque' : (t.paymentMethod || '');

    const row = [
      formatDateFriendly(t.date),
      t.currency || '',
      formatAmount(t.amount),
      t.description || '',
      t.category?.name || '',
      t.status || '',
      payment,
      t.checkNumber || '',
      t.receiptUrl || ''
    ];
    lines.push(row.map(escapeCell).join(','));
  });

  return lines.join('\r\n') + '\r\n';
};

const parseTransactionsCSV = (csvText) => {
  const clean = String(csvText || '').replace(/^\uFEFF/, '');

  let raw;
  try {
    raw = parse(clean, {
      columns: (header) => header.map((h) => String(h).trim()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true
    });
  } catch (err) {
    throw new Error(`CSV parse error: ${err.message}`);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const firstRow = raw[0] || {};
  const providedHeaders = Object.keys(firstRow);

  const required = ['Date', 'Currency', 'Amount', 'Description', 'Category', 'Payment Method'];
  const missingRequired = required.filter((h) => !providedHeaders.includes(h));

  if (missingRequired.length > 0) {
    throw new Error(`Missing required column(s): ${missingRequired.join(', ')}`);
  }

  return raw.map((row, idx) => {
    const out = { __rowIndex: idx + 2 };
    Object.entries(HEADER_TO_KEY).forEach(([header, key]) => {
      /* Accept old "Check Number" header as alias */
      if (header === 'Cheque Number' && row[header] === undefined && row['Check Number'] !== undefined) {
        out[key] = String(row['Check Number']).trim();
        return;
      }
      out[key] = row[header] !== undefined && row[header] !== null
        ? String(row[header]).trim()
        : '';
    });
    return out;
  });
};

const buildCSVTemplate = () => {
  const example = [
    '15 Jan 2025',
    'PKR',
    '2500.00',
    'Lunch with team',
    'Food',
    'Completed',
    'Cash',
    '',
    ''
  ];
  const lines = [
    CSV_HEADERS.map(escapeCell).join(','),
    example.map(escapeCell).join(',')
  ];
  return lines.join('\r\n') + '\r\n';
};

module.exports = {
  CSV_HEADERS,
  buildTransactionsCSV,
  parseTransactionsCSV,
  buildCSVTemplate
};