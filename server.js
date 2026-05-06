require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { initDB } = require('./src/db/database');
const authMiddleware = require('./src/middleware/auth');
const rateLimiter = require('./src/middleware/rateLimiter');
const { startJobs, enrichParts, checkWatchlists } = require('./src/jobs/enrichment');

const authRoutes = require('./src/routes/auth');
const partsRoutes = require('./src/routes/parts');
const crossrefRoutes = require('./src/routes/crossref');
const profileRoutes = require('./src/routes/profiles');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Security & parsing middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Public routes (no auth needed)
app.use('/api/auth', authRoutes);

// Protected routes (token required)
app.use('/api/parts', authMiddleware, partsRoutes);
app.use('/api/crossref', authMiddleware, crossrefRoutes);
app.use('/api/profiles', authMiddleware, profileRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);

// Serve dashboard
const path = require('path');
const DASH = 'C:\\Users\\allmo\\parts-api\\public\\dashboard.html';
app.use('/public', express.static('C:\\Users\\allmo\\parts-api\\public'));
app.get('/dashboard', (req, res) => res.sendFile(DASH));

// Admin: manual job triggers
app.post('/api/admin/jobs/enrich', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  enrichParts().catch(console.error);
  res.json({ message: 'Enrichment job started in background' });
});

app.post('/api/admin/jobs/watchlists', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  checkWatchlists().catch(console.error);
  res.json({ message: 'Watchlist check started in background' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server after DB is ready
initDB().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`\n🚀 Parts API running`);
    console.log(`   Local:    http://localhost:${PORT}/dashboard`);
    console.log(`   Network:  http://${process.env.LAN_IP || HOST}:${PORT}/dashboard`);
    console.log(`📦 Environment: ${process.env.NODE_ENV}`);
    console.log(`🗄️  Database ready\n`);
    startJobs();
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
