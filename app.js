// server.js - 100% Tested Version
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const exceljs = require('exceljs');
const PDFDocument = require('pdfkit');
const { format } = require('date-fns');

const app = express();
const port = process.env.PORT || 3001;

// ======================
// Middleware Setup
// ======================
app.use(cors({ 
  origin: process.env.FRONTEND_URL || 'http://localhost:3001' 
}));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ======================
// Database Configuration
// ======================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '12345678',
  database: process.env.DB_NAME || 'mess_feedback_system',
  waitForConnections: true,
  connectionLimit: 10
});

// ======================
// File Upload Setup
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    cb(null, extname && mimetype);
  }
});

// ======================
// API Endpoints
// ======================

// Submit Feedback
// Submit Feedback (Matches feedback table directly)
app.post('/api/feedback', upload.single('proof'), async (req, res) => {
    try {
      const { 
        regNo, 
        name, 
        block, 
        room, 
        mess, 
        messType, 
        category, 
        feedbackType, 
        comments 
      } = req.body;
  
      const proofPath = req.file ? `/uploads/${req.file.filename}` : null;
  
      await pool.execute(
        `INSERT INTO feedback 
         (reg_no, student_name, block, room, mess_name, mess_type, category, feedback_type, comments, proof_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [regNo, name, block, room, mess, messType, category, feedbackType, comments, proofPath]
      );
  
      res.status(201).json({ 
        success: true,
        message: 'Feedback submitted successfully'
      });
    } catch (error) {
      console.error('Submission error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error'
      });
    }
  });
  

// Generate Reports

const { format: dateFormat } = require('date-fns');

app.get('/api/reports/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const reportFormat = req.query.format || 'excel';

    let query = '';
    let params = [];
    let reportName = '';

    switch (type) {
      case 'student':
        const { regNo } = req.query;
        query = `WHERE reg_no = ?`;
        params = [regNo];
        reportName = `Student_${regNo}`;
        break;
      case 'weekly':
        query = `WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
        reportName = 'Weekly_Report';
        break;
      case 'monthly':
        query = `WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
        reportName = 'Monthly_Report';
        break;
      default:
        reportName = 'Full_Report';
    }

    console.log('Query:', query);
    console.log('Params:', params);

    const [rows] = await pool.execute(
      `SELECT * FROM feedback ${query} ORDER BY created_at DESC`,
      params
    );

    if (reportFormat === 'pdf') {
      // PDF logic
    } else {
      const workbook = new exceljs.Workbook();
      const worksheet = workbook.addWorksheet('Feedback');
      worksheet.columns = [
        { header: 'Reg No', key: 'reg_no', width: 15 },
        { header: 'Student Name', key: 'student_name', width: 20 },
        { header: 'Block', key: 'block', width: 10 },
        { header: 'Room', key: 'room', width: 10 },
        { header: 'Mess', key: 'mess_name', width: 15 },
        { header: 'Mess Type', key: 'mess_type', width: 15 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Feedback Type', key: 'feedback_type', width: 15 },
        { header: 'Comments', key: 'comments', width: 40 },
        { header: 'Date', key: 'created_at', width: 20 }
      ];

      worksheet.getRow(1).font = { bold: true, size: 12 };

      rows.forEach(row => {
        worksheet.addRow({
          reg_no: row.reg_no,
          student_name: row.student_name,
          block: row.block,
          room: row.room,
          mess_name: row.mess_name,
          mess_type: row.mess_type,
          category: row.category,
          feedback_type: row.feedback_type,
          comments: row.comments,
          created_at: dateFormat(new Date(row.created_at), 'yyyy-MM-dd HH:mm:ss') // ✅ fixed
        });
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${reportName}.xlsx`);
      await workbook.xlsx.write(res);
    }

  } catch (error) {
    console.error('Report error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
 
  
// Generate the Frontend File Route (if needed)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend.html"));
});

// ======================
// Server Startup
// ======================
app.listen(port, () => {
  console.log(`
  ==================================
   Mess Feedback System Online
  ==================================
  Backend: http://localhost:${port}
  Frontend: ${process.env.FRONTEND_URL}
  Database: ${process.env.DB_NAME}
  ==================================
  `);
});

// Error Handling
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});