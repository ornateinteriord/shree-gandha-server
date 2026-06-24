require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db.config');
const cors = require('cors');

// Debug environment variables
// console.log('Environment variables loaded:');
// console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Present' : 'Missing');
// console.log('IMAGEKIT_PUBLIC_KEY:', process.env.IMAGEKIT_PUBLIC_KEY ? 'Present' : 'Missing');
// console.log('IMAGEKIT_PRIVATE_KEY:', process.env.IMAGEKIT_PRIVATE_KEY ? 'Present' : 'Missing');
// console.log('IMAGEKIT_URL_ENDPOINT:', process.env.IMAGEKIT_URL_ENDPOINT ? 'Present' : 'Missing');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const paymentRoutes = require('./routes/payment.routes');
const promoterRoutes = require('./routes/promoter.routes')
const webenquireRoutes = require('./routes/WebEnquireRoutes')
const ImageKit = require('imagekit');
const projectName = process.env.PROJECT_NAME

const app = express();

// Add error handling middleware
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true 
}));

// Only initialize ImageKit if all required environment variables are present
let imagekit = null;
if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT) {
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
  console.log('ImageKit initialized successfully');
} else {
  console.log('ImageKit not initialized - missing environment variables');
}

// Database connection
connectDB();

// Middleware
app.use(express.json({ limit: '10mb' })); // Increase limit for large payloads

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get("/image-kit-auth", (_req, res) => {
  if (imagekit) {
    const result = imagekit.getAuthenticationParameters();
    res.send(result);
  } else {
    res.status(500).json({ error: 'ImageKit not configured' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/promoter', promoterRoutes)
app.use('/api/webenquire', webenquireRoutes)

app.get('/',(req,res) => {
  res.send(`Welcome to ${projectName} Backend`)
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Global error handler - this will catch the 500 errors from malformed Cashfree redirects
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // If this is a Cashfree redirect error, redirect to the frontend dashboard
  if (req.path.includes('thankyou') || req.path.includes('cashfree') || req.path.includes('checkout')) {
    console.log('Cashfree redirect error, redirecting to frontend dashboard');
    return res.redirect(`${process.env.FRONTEND_URL}/user/userDashboard`);
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// 404 handler - also handle Cashfree malformed URLs
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  
  // If this is a Cashfree redirect URL, redirect to the frontend dashboard
  if (req.path.includes('thankyou') || req.path.includes('cashfree') || req.path.includes('checkout')) {
    console.log('Cashfree redirect URL not found, redirecting to frontend dashboard');
    return res.redirect(`${process.env.FRONTEND_URL}/user/userDashboard`);
  }
  
  res.status(404).json({ 
    error: 'Not found',
    message: 'The requested resource was not found'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});