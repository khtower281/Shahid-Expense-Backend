const { parse } = require('csv-parse/sync');

/* -------------------------------------------------------------------------- */
/*                              CONSTANTS                                     */
/* -------------------------------------------------------------------------- */
/* Friendly headers used in the exported CSV. Order matters — used in both
   export and template. Import is header-agnostic: we map by header name. */
const CSV_HEADERS = [
  'Date',
  'Currency',
  'Amount',
  'Description',
  'Category',
  'Status',
  'Payment Method',
  'Check Number',
  'Receipt URL'
];

/* Internal key mapping: friendly header -> internal key */
const HEADER_TO_KEY = {
  'Date': 'date',
  'Currency': 'currency',
  'Amount': 'amount',
  'Description': 'description',
  'Category': 'category',
  'Status': 'status',
  'Payment Method': 'paymentMethod',
  'Check Number': 'checkNumber',
  'Receipt URL': 'receiptUrl'
};

/* Reverse mapping for export */
const KEY_TO_HEADER = Object.fromEntries(
  Object.entries(HEADER_TO_KEY).map(([k, v]) => [v, k])
);

/* -------------------------------------------------------------------------- */
/*                              UTILITIES                                     */
/* -------------------------------------------------------------------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format a date as "15 Jan 2025" — same style used in the PDF. */
const formatDateFriendly = (d) => {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

/** Format a number with 2 decimals (no thousand separators — Excel handles that). */
const formatAmount = (n) => Number(n || 0).toFixed(2);

/**
 * Escape a value for CSV output.
 * - Wrap in quotes if it contains comma, quote, newline
 * - Double any embedded quotes
 */
const escapeCell = (value) => {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/* -------------------------------------------------------------------------- */
/*                         BUILD CSV FROM TRANSACTIONS                        */
/* -------------------------------------------------------------------------- */
/**
 * Convert an array of populated Transaction docs into a CSV string.
 * Stateless — pure function. No I/O.
 *
 * @param {Array} transactions - Mongo docs with `category` populated ({ name })
 * @returns {string} CSV text (includes header row)
 */
const buildTransactionsCSV = (transactions) => {
  const lines = [];

  /* Header */
  lines.push(CSV_HEADERS.map(escapeCell).join(','));

  /* Rows */
  transactions.forEach((t) => {
    const row = [
      formatDateFriendly(t.date),
      t.currency || '',
      formatAmount(t.amount),
      t.description || '',
      t.category?.name || '',
      t.status || '',
      t.paymentMethod || '',
      t.checkNumber || '',
      t.receiptUrl || ''
    ];
    lines.push(row.map(escapeCell).join(','));
  });

  /* Trailing newline for proper POSIX-style CSV */
  return lines.join('\r\n') + '\r\n';
};

/* -------------------------------------------------------------------------- */
/*                          PARSE CSV TO ROW OBJECTS                          */
/* -------------------------------------------------------------------------- */
/**
 * Parse a CSV string into an array of { friendlyKey: value } objects.
 * Uses the header names in the file itself, so the column order can vary.
 *
 * @param {string} csvText
 * @returns {Array<Object>} rows keyed by internal names (date, currency, ...)
 * @throws {Error} on malformed CSV
 */
const parseTransactionsCSV = (csvText) => {
  /* Strip UTF-8 BOM if present */
  const clean = String(csvText || '').replace(/^\uFEFF/, '');

  /* Parse with header row auto-detection */
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

  /* Detect missing required columns before we process rows */
  const firstRow = raw[0] || {};
  const providedHeaders = Object.keys(firstRow);
  const missing = CSV_HEADERS.filter((h) => !providedHeaders.includes(h));

  /* Allow missing optional columns: Status, Check Number, Receipt URL */
  const required = ['Date', 'Currency', 'Amount', 'Description', 'Category', 'Payment Method'];
  const missingRequired = required.filter((h) => !providedHeaders.includes(h));

  if (missingRequired.length > 0) {
    throw new Error(`Missing required column(s): ${missingRequired.join(', ')}`);
  }

  /* Normalize each row to internal keys */
  return raw.map((row, idx) => {
    const out = { __rowIndex: idx + 2 }; // +2 → spreadsheet row (header is 1)
    Object.entries(HEADER_TO_KEY).forEach(([header, key]) => {
      out[key] = row[header] !== undefined && row[header] !== null
        ? String(row[header]).trim()
        : '';
    });
    return out;
  });
};

/* -------------------------------------------------------------------------- */
/*                          TEMPLATE BUILDER                                  */
/* -------------------------------------------------------------------------- */
/**
 * Generate a downloadable CSV template with headers + one example row.
 * Returned as a string — nothing written to disk.
 */
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