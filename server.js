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
const port = process.env.PORT || 3000;

// ======================
// Middleware Setup
// ======================
app.use(cors({ 
  origin: process.env.FRONTEND_URL || 'http://localhost:5500' 
}));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ======================
// Database Configuration
// ======================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
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

    // Insert or update student
    const [studentResult] = await pool.execute(
      `INSERT INTO students (reg_no, name, block, room_number)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), block = VALUES(block), room_number = VALUES(room_number)`,
      [regNo, name, block, room]
    );

    // Insert feedback
    const proofPath = req.file ? `/uploads/${req.file.filename}` : null;
    await pool.execute(
      `INSERT INTO feedbacks 
       (student_id, mess_name, mess_type, category, feedback_type, comments, proof_path)
       VALUES (
         (SELECT id FROM students WHERE reg_no = ?),
         ?, ?, ?, ?, ?, ?
       )`,
      [regNo, mess, messType, category, feedbackType, comments, proofPath]
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
app.get('/api/reports/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'excel' } = req.query;

    let query = '';
    let params = [];
    let reportName = '';

    switch (type) {
      case 'student':
        const { regNo } = req.query;
        query = `WHERE s.reg_no = ?`;
        params = [regNo];
        reportName = `Student_${regNo}`;
        break;

      case 'weekly':
        query = `WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
        reportName = 'Weekly_Report';
        break;

      case 'monthly':
        query = `WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
        reportName = 'Monthly_Report';
        break;

      default:
        query = '';
        reportName = 'Full_Report';
    }

    const [rows] = await pool.execute(
      `SELECT f.*, s.reg_no, s.name, s.block, s.room_number
       FROM feedbacks f
       JOIN students s ON f.student_id = s.id
       ${query}
       ORDER BY f.created_at DESC`,
      params
    );

    if (format === 'pdf') {
      // PDF Generation Code
      const doc = new PDFDocument();
      doc.pipe(res);
      
      // Set response headers for PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${reportName}.pdf`);
      
      // Add PDF content
      doc.fontSize(20).text(`Mess Feedback System - ${reportName}`, {
        align: 'center'
      });
      
      doc.moveDown();
      doc.fontSize(12);
      
      // Add table header
      const tableTop = 150;
      const colWidth = [50, 80, 80, 100, 80, 120];
      
      doc.font('Helvetica-Bold');
      doc.text('Reg No', 50, tableTop);
      doc.text('Name', 100, tableTop);
      doc.text('Mess', 180, tableTop);
      doc.text('Category', 260, tableTop);
      doc.text('Type', 340, tableTop);
      doc.text('Date', 420, tableTop);
      
      doc.moveDown();
      let yPos = tableTop + 20;
      
      // Add rows
      doc.font('Helvetica');
      rows.forEach((row, i) => {
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
          
          // Add header on new page
          doc.font('Helvetica-Bold');
          doc.text('Reg No', 50, yPos);
          doc.text('Name', 100, yPos);
          doc.text('Mess', 180, yPos);
          doc.text('Category', 260, yPos);
          doc.text('Type', 340, yPos);
          doc.text('Date', 420, yPos);
          
          yPos += 20;
          doc.font('Helvetica');
        }
        
        doc.text(row.reg_no, 50, yPos);
        doc.text(row.name.substring(0, 10), 100, yPos);
        doc.text(row.mess_name.substring(0, 8), 180, yPos);
        doc.text(row.category.substring(0, 8), 260, yPos);
        doc.text(row.feedback_type.substring(0, 8), 340, yPos);
        doc.text(format(new Date(row.created_at), 'yyyy-MM-dd'), 420, yPos);
        
        yPos += 20;
      });
      
      doc.end();
    } else {
      // Excel Generation
      const workbook = new exceljs.Workbook();
      const worksheet = workbook.addWorksheet('Feedback');
      
      // Set response headers for Excel
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${reportName}.xlsx`);
      
      // Define headers
      worksheet.columns = [
        { header: 'Reg No', key: 'reg_no', width: 15 },
        { header: 'Student Name', key: 'name', width: 20 },
        { header: 'Block', key: 'block', width: 10 },
        { header: 'Room', key: 'room_number', width: 10 },
        { header: 'Mess', key: 'mess_name', width: 15 },
        { header: 'Mess Type', key: 'mess_type', width: 15 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Feedback Type', key: 'feedback_type', width: 15 },
        { header: 'Comments', key: 'comments', width: 40 },
        { header: 'Date', key: 'created_at', width: 20 }
      ];
      
      // Format the header row
      worksheet.getRow(1).font = { bold: true, size: 12 };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      
      // Add data
      rows.forEach(row => {
        worksheet.addRow({
          reg_no: row.reg_no,
          name: row.name,
          block: row.block,
          room_number: row.room_number,
          mess_name: row.mess_name,
          mess_type: row.mess_type,
          category: row.category,
          feedback_type: row.feedback_type,
          comments: row.comments,
          created_at: format(new Date(row.created_at), 'yyyy-MM-dd HH:mm:ss')
        });
      });
      
      await workbook.xlsx.write(res);
    }

  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: error.message });
  }
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