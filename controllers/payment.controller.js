const axios = require('axios');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Profile = require('../models/profile');
const UserModel = require('../models/user');
const PromotersEarningsModel = require('../models/promoters/PromotersEarnings');
const IncompletePayment = require('../models/IncompletePayment');
const PromotersModel = require('../models/promoters/Promoters');
const PromoterTransactionModel = require('../models/promoters/PromotersTransaction');


// Get environment variables
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

// Cashfree API Base URLs - Switch based on NODE_ENV
const CASHFREE_BASE_URL = process.env.NODE_ENV === "PROD"
  ? "https://api.cashfree.com/pg/orders"
  : "https://sandbox.cashfree.com/pg/orders";

const X_API_VERSION = "2022-09-01";

// Create Order
const createOrder = async (req, res) => {
  try {
    const { orderId, orderAmount, customerName, customerEmail, customerPhone, planType, promocode, originalAmount, context } = req.body;

    // Validate required fields
    if (!orderId || !orderAmount || !customerName || !customerEmail || !customerPhone) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['orderId', 'orderAmount', 'customerName', 'customerEmail', 'customerPhone']
      });
    }

    console.log('Creating payment order:', {
      orderId,
      orderAmount,
      customerName,
      customerEmail,
      customerPhone,
      planType,
      promocode,
      originalAmount,
      context
    });

    // Ensure all required data is properly formatted
    const parsedAmount = Math.round(parseFloat(orderAmount) * 100) / 100; // Round to 2 decimal places
    
    // Determine return URL based on context
    let returnUrl;
    if (context === "registration") {
      // For new registrations, redirect to activation-pending
      returnUrl = `${process.env.FRONTEND_URL}/activation-pending?registration_success=true`;
    } else if (context === "existing_user") {
      // For existing users, redirect to user dashboard
      returnUrl = `${process.env.FRONTEND_URL}/user/userDashboard`;
    } else {
      // Default case, redirect to user dashboard
      returnUrl = `${process.env.FRONTEND_URL}/user/userDashboard`;
    }

    const orderData = {
      order_id: String(orderId),
      order_amount: parsedAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: String(customerPhone).replace(/[^0-9]/g, ''), // Only digits
        customer_name: String(customerName).trim(),
        customer_email: String(customerEmail).trim().toLowerCase(),
        customer_phone: String(customerPhone).replace(/[^0-9]/g, ''), // Only digits
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: `${process.env.BACKEND_URL}/api/payment/webhook`
      }
    };

    // Add metadata as order_note (safer than order_tags)
    const metadata = {
      planType: String(planType || 'silver'),
      promocode: promocode ? String(promocode) : null,
      originalAmount: originalAmount ? parseFloat(originalAmount) : parsedAmount
    };
    
    orderData.order_note = JSON.stringify(metadata);

    console.log('Final order data to send:', {
      order_id: orderData.order_id,
      order_amount: orderData.order_amount,
      order_currency: orderData.order_currency,
      customer_id: orderData.customer_details.customer_id,
      customer_name: orderData.customer_details.customer_name,
      customer_email: orderData.customer_details.customer_email,
      customer_phone: orderData.customer_details.customer_phone,
      return_url: orderData.order_meta.return_url,
      notify_url: orderData.order_meta.notify_url,
      order_note: orderData.order_note
    });

    const response = await axios.post(
      CASHFREE_BASE_URL,
      orderData,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CASHFREE_APP_ID,
          "x-client-secret": CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    console.log('✅ Order created successfully:', orderId);
    console.log('Cashfree response:', {
      cf_order_id: response.data.cf_order_id,
      order_status: response.data.order_status,
      payment_session_id: response.data.payment_session_id,
      cashfree_env: process.env.NODE_ENV === "PROD" ? "production" : "sandbox"
    });

    // Return additional data for frontend display
    // Include cashfree_env so frontend uses the same environment as backend
    const responseData = {
      ...response.data,
      originalAmount: originalAmount ? parseFloat(originalAmount) : parsedAmount,
      finalAmount: parsedAmount,
      discountApplied: originalAmount ? (parseFloat(originalAmount) - parsedAmount) : 0,
      planType: planType || 'silver',
      // Tell frontend which Cashfree environment to use (must match backend)
      cashfree_env: process.env.NODE_ENV === "PROD" ? "production" : "sandbox"
    };

    res.json(responseData);
  } catch (error) {
    console.error('❌ Create order error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      }
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create payment order';
    let statusCode = 500;
    
    if (error.response?.status === 400) {
      errorMessage = 'Invalid payment data provided';
      statusCode = 400;
    } else if (error.response?.status === 401) {
      errorMessage = 'Payment gateway authentication failed';
      statusCode = 401;
    } else if (error.response?.status === 422) {
      errorMessage = 'Payment gateway validation failed';
      statusCode = 422;
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      errorMessage = 'Payment gateway connection failed';
      statusCode = 503;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Payment gateway request timeout';
      statusCode = 504;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.response?.data || error.message,
      orderId: orderId
    });
  }
};

// Manual payment verification route (fallback if webhook fails)
const verifyPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Validate order ID
    if (!orderId || orderId.includes('{') || orderId.includes('}') || 
        orderId.includes('KTAqpwFjFCDenUW6j_Yo1xEJv9-Y5Ng_42YTJk9YQt4N0EW7yy3nOgEpayment')) {
      return res.status(400).json({ 
        error: 'Invalid order ID',
        message: 'Order ID contains invalid characters'
      });
    }
    
    console.log(`Manual payment verification for order: ${orderId}`);
    
    // Check if this order has already been processed
    const existingTransaction = await Transaction.findOne({ orderno: orderId });
    if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
      console.log(`Order ${orderId} already processed successfully`);
      return res.json({ 
        success: true, 
        message: 'Payment already processed successfully',
        orderStatus: 'PAID',
        paymentStatus: 'SUCCESS',
        alreadyProcessed: true
      });
    }
    
    // Check Cashfree API for payment status
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/${orderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CASHFREE_APP_ID,
          "x-client-secret": CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );
    
    const orderData = response.data;
    console.log('Order status from Cashfree:', JSON.stringify(orderData, null, 2));
    
    // Handle the specific case where order is PAID but payment status is NOT_ATTEMPTED
    // This can happen when Cashfree has processed the order but hasn't updated the payment status yet
    if (orderData.order_status === 'PAID' && orderData.payment_status === 'NOT_ATTEMPTED') {
      console.log('Handling PAID order with NOT_ATTEMPTED payment status');
      
      // Save this incomplete payment for admin review
      await saveIncompletePayment({
        orderId: orderData.order_id,
        amount: orderData.order_amount,
        customerDetails: {
          customerId: orderData.customer_details?.customer_id,
          customerName: orderData.customer_details?.customer_name,
          customerEmail: orderData.customer_details?.customer_email,
          customerPhone: orderData.customer_details?.customer_phone
        },
        userId: orderData.customer_details?.customer_id, // Use customer ID as user ID
        paymentMethod: orderData.payment_method,
        paymentStatusFromGateway: orderData.payment_status,
        orderStatusFromGateway: orderData.order_status,
        gatewayResponse: orderData
      });
      
      // Wait a moment and check again
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      
      // Check again
      const secondResponse = await axios.get(
        `${CASHFREE_BASE_URL}/${orderId}`,
        {
          headers: {
            "Content-Type": "application/json",
            "x-client-id": CASHFREE_APP_ID,
            "x-client-secret": CASHFREE_SECRET_KEY,
            "x-api-version": "2022-09-01",
          },
        }
      );
      
      const secondOrderData = secondResponse.data;
      console.log('Second check order status from Cashfree:', JSON.stringify(secondOrderData, null, 2));
      
      if (secondOrderData.order_status === 'PAID' && secondOrderData.payment_status === 'SUCCESS') {
        // Now it's successful, process it
        console.log('Payment now showing as SUCCESS, processing...');
        const webhookData = {
          type: 'PAYMENT_SUCCESS_WEBHOOK',
          data: {
            order: secondOrderData,
            payment: {
              cf_payment_id: secondOrderData.cf_order_id,
              payment_status: 'SUCCESS',
              payment_method: secondOrderData.payment_method || 'UPI'
            },
            customer_details: secondOrderData.customer_details
          }
        };
        
        await processSuccessfulPayment({
          orderId: secondOrderData.order_id,
          paymentId: secondOrderData.cf_order_id,
          orderAmount: secondOrderData.order_amount,
          paymentData: webhookData.data
        });
        
        // Mark the incomplete payment as resolved
        await IncompletePayment.updateOne(
          { orderId: secondOrderData.order_id },
          { 
            resolved: true,
            resolutionNotes: 'Payment successfully processed on second attempt'
          }
        );
        
        res.json({ 
          success: true, 
          message: 'Payment verified and processed successfully',
          orderStatus: secondOrderData.order_status,
          paymentStatus: secondOrderData.payment_status
        });
      } else if (secondOrderData.order_status === 'PAID' && secondOrderData.payment_status === 'NOT_ATTEMPTED') {
        // Still NOT_ATTEMPTED after second check, this might be a Cashfree issue
        console.log('Still NOT_ATTEMPTED after second check, checking for payment data');
        
        // Let's check if there's any payment data that indicates success
        if (secondOrderData.payments && secondOrderData.payments.length > 0) {
          const latestPayment = secondOrderData.payments[0]; // Assuming first payment is the latest
          console.log('Found payment data:', JSON.stringify(latestPayment, null, 2));
          
          if (latestPayment.status === 'SUCCESS') {
            console.log('Payment data shows SUCCESS, processing based on payment data');
            
            // Check if already processed
            const existingTransaction = await Transaction.findOne({ orderno: orderId });
            if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
              console.log(`Order ${orderId} already processed successfully`);
              // Mark the incomplete payment as resolved
              await IncompletePayment.updateOne(
                { orderId: secondOrderData.order_id },
                { 
                  resolved: true,
                  resolutionNotes: 'Payment already processed successfully'
                }
              );
              return res.json({ 
                success: true, 
                message: 'Payment already processed successfully',
                orderStatus: 'PAID',
                paymentStatus: 'SUCCESS',
                alreadyProcessed: true
              });
            }
            
            // Process based on payment data even if overall status is NOT_ATTEMPTED
            const webhookData = {
              type: 'PAYMENT_SUCCESS_WEBHOOK',
              data: {
                order: secondOrderData,
                payment: {
                  cf_payment_id: latestPayment.cf_payment_id,
                  payment_status: 'SUCCESS',
                  payment_method: latestPayment.payment_method || 'UPI'
                },
                customer_details: secondOrderData.customer_details
              }
            };
            
            await processSuccessfulPayment({
              orderId: secondOrderData.order_id,
              paymentId: latestPayment.cf_payment_id,
              orderAmount: secondOrderData.order_amount,
              paymentData: webhookData.data
            });
            
            // Mark the incomplete payment as resolved
            await IncompletePayment.updateOne(
              { orderId: secondOrderData.order_id },
              { 
                resolved: true,
                resolutionNotes: 'Payment processed based on payment data'
              }
            );
            
            res.json({ 
              success: true, 
              message: 'Payment verified and processed successfully',
              orderStatus: secondOrderData.order_status,
              paymentStatus: latestPayment.status
            });
          } else {
            // Payment not completed
            console.log('Payment data does not show SUCCESS');
            res.json({ 
              success: false, 
              message: 'Payment not completed',
              orderStatus: secondOrderData.order_status,
              paymentStatus: latestPayment.status || 'NOT_ATTEMPTED'
            });
          }
        } else {
          // No payment data, still not completed
          console.log('No payment data found');
          res.json({ 
            success: false, 
            message: 'Payment not completed',
            orderStatus: secondOrderData.order_status,
            paymentStatus: secondOrderData.payment_status
          });
        }
      } else {
        // Other status combinations
        console.log('Other status combination after second check');
        res.json({ 
          success: false, 
          message: 'Payment not completed',
          orderStatus: secondOrderData.order_status || 'NOT_CREATED',
          paymentStatus: secondOrderData.payment_status || 'NOT_ATTEMPTED'
        });
      }
    }
    // Check if payment was actually completed
    // Only process as successful if order_status is 'PAID' AND payment is confirmed
    else if (orderData.order_status === 'PAID' && orderData.payment_status === 'SUCCESS') {
      console.log('Order and payment both show SUCCESS, processing...');
      
      // Simulate webhook data structure for processing
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: orderData.cf_order_id,
            payment_status: 'SUCCESS',
            payment_method: orderData.payment_method || 'UPI'
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: orderData.cf_order_id,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true, 
        message: 'Payment verified and processed successfully',
        orderStatus: orderData.order_status,
        paymentStatus: orderData.payment_status
      });
    } else if (orderData.order_status === 'PAID') {
      // Order is marked as PAID in Cashfree - trust this status and process payment successfully
      console.log('Order status is PAID in Cashfree, processing payment successfully...');
      
      // Check if there's any payment data to use
      let paymentId = orderData.cf_order_id;
      let paymentMethod = orderData.payment_method || 'UPI';
      
      // If there are payments array, use the first successful payment or just the first payment
      if (orderData.payments && orderData.payments.length > 0) {
        const successfulPayment = orderData.payments.find(p => p.status === 'SUCCESS');
        const paymentToUse = successfulPayment || orderData.payments[0];
        paymentId = paymentToUse.cf_payment_id;
        paymentMethod = paymentToUse.payment_method || paymentMethod;
        console.log('Using payment data:', JSON.stringify(paymentToUse, null, 2));
      }
      
      // Simulate webhook data structure for processing
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: paymentId,
            payment_status: 'SUCCESS',
            payment_method: paymentMethod
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: paymentId,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true, 
        message: 'Payment verified and processed successfully',
        orderStatus: orderData.order_status,
        paymentStatus: 'SUCCESS'
      });
    } else {
      // Payment not completed
      console.log('Payment not completed, order status:', orderData.order_status, 'payment status:', orderData.payment_status);
      res.json({ 
        success: false, 
        message: 'Payment not completed',
        orderStatus: orderData.order_status || 'NOT_CREATED',
        paymentStatus: orderData.payment_status || 'NOT_ATTEMPTED'
      });
    }
    
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error.message);
    
    // If it's a malformed order ID, return a proper error response
    if (error.message && (error.message.includes('Invalid order ID') || 
        req.params.orderId.includes('{') || req.params.orderId.includes('}') ||
        req.params.orderId.includes('KTAqpwFjFCDenUW6j_Yo1xEJv9-Y5Ng_42YTJk9YQt4N0EW7yy3nOgEpayment'))) {
      return res.status(400).json({ 
        error: 'Invalid order ID',
        message: 'Order ID contains invalid characters'
      });
    }
    
    res.status(500).json({ 
      error: 'Payment verification failed', 
      details: error.response?.data || error.message 
    });
  }
};

// Endpoint to get a specific incomplete payment by order ID (for admin)
const getIncompletePayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const incompletePayment = await IncompletePayment.findOne({ orderId });
    if (!incompletePayment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Incomplete payment record not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: incompletePayment 
    });
  } catch (error) {
    console.error('Error fetching incomplete payment:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch incomplete payment',
      details: error.message 
    });
  }
};

// Webhook to verify payment
const handleWebhook = async (req, res) => {
  console.log('=== CASHFREE WEBHOOK RECEIVED ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));

  try {
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    // Handle raw body - ensure we have the exact string that was signed
    let rawBody;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body);
    }
    console.log('📄 Raw webhook body:', rawBody);

    // Verify signature for security (improved method matching MLM implementation)
    if (signature && timestamp) {
      const payload = `${timestamp}${rawBody}`;
      const expectedSignature = crypto
        .createHmac('sha256', CASHFREE_SECRET_KEY)
        .update(payload)
        .digest('base64');

      console.log('Signature verification:', {
        received: signature,
        expected: expectedSignature,
        match: signature === expectedSignature
      });

      if (signature !== expectedSignature) {
        console.error('Invalid webhook signature');
        return res.status(401).send('Invalid signature');
      }
    } else {
      console.warn('No webhook signature or timestamp provided');
    }

    // Parse body if needed
    const event = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody);

    console.log('✅ Verified webhook data:', JSON.stringify(event, null, 2));

    // Process payment event
    if (event.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const paymentData = event.data;
      const orderId = paymentData.order?.order_id;
      const paymentId = paymentData.payment?.cf_payment_id;
      const orderAmount = paymentData.order?.order_amount;
      const paymentStatus = paymentData.payment?.payment_status;
      
      console.log(`Processing payment: ${paymentId}, Order: ${orderId}, Status: ${paymentStatus}`);
      
      if (paymentStatus === 'SUCCESS') {
        await processSuccessfulPayment({
          orderId,
          paymentId,
          orderAmount,
          paymentData
        });
        console.log('✅ Payment processed successfully');
      } else {
        // Save incomplete payment for admin review
        await saveIncompletePayment({
          orderId: orderId,
          transactionId: paymentId,
          amount: orderAmount,
          customerDetails: {
            customerId: paymentData.customer_details?.customer_id,
            customerName: paymentData.customer_details?.customer_name,
            customerEmail: paymentData.customer_details?.customer_email,
            customerPhone: paymentData.customer_details?.customer_phone
          },
          userId: paymentData.customer_details?.customer_id, // Use customer ID as user ID
          paymentMethod: paymentData.payment?.payment_method,
          paymentStatusFromGateway: paymentStatus,
          orderStatusFromGateway: paymentData.order?.order_status,
          gatewayResponse: event
        });
        
        await processFailedPayment({
          orderId,
          paymentId,
          paymentStatus,
          paymentData
        });
        console.log('❌ Payment failed, recorded in database');
      }
    } else {
      console.log('Webhook event type:', event.type, '- No action needed');
    }

    res.status(200).json({ message: "Webhook received successfully", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: "Webhook processing failed", details: error.message });
  }
};

// Endpoint to retry payment verification for pending orders
const retryPayment = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Validate order ID
    if (!orderId || orderId.includes('{') || orderId.includes('}') || 
        orderId.includes('KTAqpwFjFCDenUW6j_Yo1xEJv9-Y5Ng_42YTJk9YQt4N0EW7yy3nOgEpayment')) {
      return res.status(400).json({ 
        error: 'Invalid order ID',
        message: 'Order ID contains invalid characters'
      });
    }
    
    console.log(`Retrying payment verification for order: ${orderId}`);
    
    // Check Cashfree API for payment status
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/${orderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CASHFREE_APP_ID,
          "x-client-secret": CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );
    
    const orderData = response.data;
    console.log('Retry order status from Cashfree:', JSON.stringify(orderData, null, 2));
    
    // Handle the specific case where order is PAID but payment status is NOT_ATTEMPTED
    if (orderData.order_status === 'PAID' && orderData.payment_status === 'NOT_ATTEMPTED') {
      console.log('Retry: Handling PAID order with NOT_ATTEMPTED payment status');
      
      // Save this incomplete payment for admin review if not already saved
      await saveIncompletePayment({
        orderId: orderData.order_id,
        transactionId: orderData.cf_order_id,
        amount: orderData.order_amount,
        customerDetails: {
          customerId: orderData.customer_details?.customer_id,
          customerName: orderData.customer_details?.customer_name,
          customerEmail: orderData.customer_details?.customer_email,
          customerPhone: orderData.customer_details?.customer_phone
        },
        paymentMethod: orderData.payment_method,
        paymentStatusFromGateway: orderData.payment_status,
        orderStatusFromGateway: orderData.order_status,
        gatewayResponse: orderData
      });
      
      // Check if there's any payment data that indicates success
      if (orderData.payments && orderData.payments.length > 0) {
        const latestPayment = orderData.payments[0]; // Assuming first payment is the latest
        console.log('Retry: Found payment data:', JSON.stringify(latestPayment, null, 2));
        
        if (latestPayment.status === 'SUCCESS') {
          console.log('Retry: Payment data shows SUCCESS, processing based on payment data');
          
          // Check if already processed
          const existingTransaction = await Transaction.findOne({ orderno: orderId });
          if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
            console.log(`Retry: Order ${orderId} already processed successfully`);
            // Mark the incomplete payment as resolved
            await IncompletePayment.updateOne(
              { orderId: orderData.order_id },
              { 
                resolved: true,
                resolutionNotes: 'Payment already processed successfully'
              }
            );
            return res.json({ 
              success: true, 
              message: 'Payment already processed successfully',
              orderStatus: 'PAID',
              paymentStatus: 'SUCCESS',
              alreadyProcessed: true
            });
          }
          
          // Process based on payment data even if overall status is NOT_ATTEMPTED
          const webhookData = {
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: {
              order: orderData,
              payment: {
                cf_payment_id: latestPayment.cf_payment_id,
                payment_status: 'SUCCESS',
                payment_method: latestPayment.payment_method || 'UPI'
              },
              customer_details: orderData.customer_details
            }
          };
          
          await processSuccessfulPayment({
            orderId: orderData.order_id,
            paymentId: latestPayment.cf_payment_id,
            orderAmount: orderData.order_amount,
            paymentData: webhookData.data
          });
          
          // Mark the incomplete payment as resolved
          await IncompletePayment.updateOne(
            { orderId: orderData.order_id },
            { 
              resolved: true,
              resolutionNotes: 'Payment processed based on payment data'
            }
          );
          
          res.json({ 
            success: true, 
            message: 'Payment verified and processed successfully',
            orderStatus: orderData.order_status,
            paymentStatus: latestPayment.status
          });
        } else {
          // Payment not completed
          console.log('Retry: Payment data does not show SUCCESS');
          res.json({ 
            success: false, 
            message: 'Payment not completed',
            orderStatus: orderData.order_status,
            paymentStatus: latestPayment.status || 'NOT_ATTEMPTED'
          });
        }
      } else {
        // No payment data, still not completed
        console.log('Retry: No payment data found');
        res.json({ 
          success: false, 
            message: 'Payment not completed',
          orderStatus: orderData.order_status,
          paymentStatus: orderData.payment_status
        });
      }
    }
    // Check if payment was actually completed
    else if (orderData.order_status === 'PAID' && orderData.payment_status === 'SUCCESS') {
      console.log('Retry: Order and payment both show SUCCESS, processing...');
      
      // Check if already processed
      const existingTransaction = await Transaction.findOne({ orderno: orderId });
      if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
        console.log(`Retry: Order ${orderId} already processed successfully`);
        return res.json({ 
          success: true, 
          message: 'Payment already processed successfully',
          orderStatus: 'PAID',
          paymentStatus: 'SUCCESS',
          alreadyProcessed: true
        });
      }
      
      // Process successful payment
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: orderData.cf_order_id,
            payment_status: 'SUCCESS',
            payment_method: orderData.payment_method || 'UPI'
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: orderData.cf_order_id,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true, 
        message: 'Payment verified and processed successfully',
        orderStatus: orderData.order_status,
        paymentStatus: orderData.payment_status
      });
    } else if (orderData.order_status === 'PAID') {
      // Order is marked as PAID in Cashfree - trust this status and process payment successfully
      console.log('Retry: Order status is PAID in Cashfree, processing payment successfully...');
      
      // Check if there's any payment data to use
      let paymentId = orderData.cf_order_id;
      let paymentMethod = orderData.payment_method || 'UPI';
      
      // If there are payments array, use the first successful payment or just the first payment
      if (orderData.payments && orderData.payments.length > 0) {
        const successfulPayment = orderData.payments.find(p => p.status === 'SUCCESS');
        const paymentToUse = successfulPayment || orderData.payments[0];
        paymentId = paymentToUse.cf_payment_id;
        paymentMethod = paymentToUse.payment_method || paymentMethod;
        console.log('Retry: Using payment data:', JSON.stringify(paymentToUse, null, 2));
      }
      
      // Check if already processed
      const existingTransaction = await Transaction.findOne({ orderno: orderId });
      if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
        console.log(`Retry: Order ${orderId} already processed successfully`);
        return res.json({ 
          success: true, 
          message: 'Payment already processed successfully',
          orderStatus: 'PAID',
          paymentStatus: 'SUCCESS',
          alreadyProcessed: true
        });
      }
      
      // Process successful payment
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: paymentId,
            payment_status: 'SUCCESS',
            payment_method: paymentMethod
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: paymentId,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true, 
        message: 'Payment verified and processed successfully',
        orderStatus: orderData.order_status,
        paymentStatus: 'SUCCESS'
      });
    } else {
      // Payment not completed
      console.log('Retry: Payment not completed, order status:', orderData.order_status, 'payment status:', orderData.payment_status);
      res.json({ 
        success: false, 
        message: 'Payment not completed',
        orderStatus: orderData.order_status || 'NOT_CREATED',
        paymentStatus: orderData.payment_status || 'NOT_ATTEMPTED'
      });
    }
  } catch (error) {
    console.error('Payment retry error:', error.response?.data || error.message);
    
    // If it's a malformed order ID, return a proper error response
    if (error.message && (error.message.includes('Invalid order ID') || 
        req.params.orderId.includes('{') || req.params.orderId.includes('}') ||
        req.params.orderId.includes('KTAqpwFjFCDenUW6j_Yo1xEJv9-Y5Ng_42YTJk9YQt4N0EW7yy3nOgEpayment'))) {
      return res.status(400).json({ 
        error: 'Invalid order ID',
        message: 'Order ID contains invalid characters'
      });
    }
    
    res.status(500).json({ 
      error: 'Payment retry failed', 
      details: error.response?.data || error.message 
    });
  }
};

// Handle payment redirect from Cashfree
const handlePaymentRedirect = async (req, res) => {
  try {
    const { order_id, order_token } = req.query;
    
    if (!order_id) {
      return res.status(400).json({ 
        error: 'Missing order ID',
        message: 'Order ID is required for payment verification'
      });
    }
    
    console.log(`Payment redirect received for order: ${order_id}`);
    
    // Check if payment was successful by calling Cashfree API
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/${order_id}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CASHFREE_APP_ID,
          "x-client-secret": CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );
    
    const orderData = response.data;
    console.log('Redirect verification - Order status from Cashfree:', JSON.stringify(orderData, null, 2));
    
    // Check if already processed
    const existingTransaction = await Transaction.findOne({ orderno: order_id });
    if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
      console.log(`Order ${order_id} already processed successfully`);
      return res.json({ 
        success: true, 
        message: 'Payment already processed successfully',
        orderStatus: 'PAID',
        paymentStatus: 'SUCCESS',
        alreadyProcessed: true
      });
    }
    
    // Handle different payment states
    if (orderData.order_status === 'PAID' && orderData.payment_status === 'SUCCESS') {
      // Payment successful
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: orderData.cf_order_id,
            payment_status: 'SUCCESS',
            payment_method: orderData.payment_method || 'UPI'
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: orderData.cf_order_id,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true, 
        message: 'Payment verified and processed successfully',
        orderStatus: orderData.order_status,
        paymentStatus: orderData.payment_status,
        redirectUrl: `${process.env.FRONTEND_URL}/user/userDashboard?payment=success&order_id=${order_id}`
      });
      
    } else if (orderData.order_status === 'PAID' && 
               (orderData.payment_status === 'PENDING' || orderData.payment_status === 'NOT_ATTEMPTED')) {
      // Payment might be in progress, save as incomplete and return pending status
      await saveIncompletePayment({
        orderId: orderData.order_id,
        transactionId: orderData.cf_order_id,
        amount: orderData.order_amount,
        customerDetails: {
          customerId: orderData.customer_details?.customer_id,
          customerName: orderData.customer_details?.customer_name,
          customerEmail: orderData.customer_details?.customer_email,
          customerPhone: orderData.customer_details?.customer_phone
        },
        userId: orderData.customer_details?.customer_id,
        paymentMethod: orderData.payment_method,
        paymentStatusFromGateway: orderData.payment_status,
        orderStatusFromGateway: orderData.order_status,
        gatewayResponse: orderData
      });
      
      res.json({ 
        success: false, 
        message: 'Payment is still being processed',
        orderStatus: orderData.order_status,
        paymentStatus: orderData.payment_status,
        redirectUrl: `${process.env.FRONTEND_URL}/user/userDashboard?payment=pending&order_id=${order_id}`
      });
      
    } else {
      // Payment failed or not completed
      res.json({ 
        success: false, 
        message: 'Payment was not completed successfully',
        orderStatus: orderData.order_status || 'NOT_CREATED',
        paymentStatus: orderData.payment_status || 'NOT_ATTEMPTED',
        redirectUrl: `${process.env.FRONTEND_URL}/user/userDashboard?payment=failed&order_id=${order_id}`
      });
    }
    
  } catch (error) {
    console.error('Payment redirect verification error:', error.response?.data || error.message);
    
    res.status(500).json({ 
      error: 'Payment verification failed', 
      details: error.response?.data || error.message,
      redirectUrl: `${process.env.FRONTEND_URL}/user/userDashboard?payment=error`
    });
  }
};

// Enhanced payment status check with retry logic
const checkPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId || orderId.includes('{') || orderId.includes('}')) {
      return res.status(400).json({ 
        error: 'Invalid order ID',
        message: 'Order ID contains invalid characters'
      });
    }
    
    console.log(`Checking payment status for order: ${orderId}`);
    
    // Check if already processed
    const existingTransaction = await Transaction.findOne({ orderno: orderId });
    if (existingTransaction) {
      return res.json({ 
        success: true,
        orderStatus: (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success') ? 'PAID' : 'FAILED',
        paymentStatus: (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success') ? 'SUCCESS' : 'FAILED',
        transactionId: existingTransaction.PG_id,
        amount: existingTransaction.amount,
        alreadyProcessed: true
      });
    }
    
    // Check Cashfree API
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/${orderId}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CASHFREE_APP_ID,
          "x-client-secret": CASHFREE_SECRET_KEY,
          "x-api-version": "2022-09-01",
        },
      }
    );
    
    const orderData = response.data;
    console.log('Status check - Order data from Cashfree:', JSON.stringify(orderData, null, 2));
    
    // Handle different scenarios
    if (orderData.order_status === 'PAID' && orderData.payment_status === 'SUCCESS') {
      // Process the successful payment
      const webhookData = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: orderData,
          payment: {
            cf_payment_id: orderData.cf_order_id,
            payment_status: 'SUCCESS',
            payment_method: orderData.payment_method || 'UPI'
          },
          customer_details: orderData.customer_details
        }
      };
      
      await processSuccessfulPayment({
        orderId: orderData.order_id,
        paymentId: orderData.cf_order_id,
        orderAmount: orderData.order_amount,
        paymentData: webhookData.data
      });
      
      res.json({ 
        success: true,
        orderStatus: 'PAID',
        paymentStatus: 'SUCCESS',
        transactionId: orderData.cf_order_id,
        amount: orderData.order_amount,
        message: 'Payment processed successfully'
      });
      
    } else if (orderData.order_status === 'PAID' && 
               (orderData.payment_status === 'PENDING' || orderData.payment_status === 'NOT_ATTEMPTED')) {
      // Check if there are any successful payments in the payments array
      if (orderData.payments && orderData.payments.length > 0) {
        const successfulPayment = orderData.payments.find(p => p.status === 'SUCCESS');
        
        if (successfulPayment) {
          console.log('Found successful payment in payments array, processing...');
          
          const webhookData = {
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: {
              order: orderData,
              payment: {
                cf_payment_id: successfulPayment.cf_payment_id,
                payment_status: 'SUCCESS',
                payment_method: successfulPayment.payment_method || 'UPI'
              },
              customer_details: orderData.customer_details
            }
          };
          
          await processSuccessfulPayment({
            orderId: orderData.order_id,
            paymentId: successfulPayment.cf_payment_id,
            orderAmount: orderData.order_amount,
            paymentData: webhookData.data
          });
          
          res.json({ 
            success: true,
            orderStatus: 'PAID',
            paymentStatus: 'SUCCESS',
            transactionId: successfulPayment.cf_payment_id,
            amount: orderData.order_amount,
            message: 'Payment processed successfully based on payment data'
          });
          
          return;
        }
      }
      
      // Save as incomplete payment
      await saveIncompletePayment({
        orderId: orderData.order_id,
        transactionId: orderData.cf_order_id,
        amount: orderData.order_amount,
        customerDetails: {
          customerId: orderData.customer_details?.customer_id,
          customerName: orderData.customer_details?.customer_name,
          customerEmail: orderData.customer_details?.customer_email,
          customerPhone: orderData.customer_details?.customer_phone
        },
        userId: orderData.customer_details?.customer_id,
        paymentMethod: orderData.payment_method,
        paymentStatusFromGateway: orderData.payment_status,
        orderStatusFromGateway: orderData.order_status,
        gatewayResponse: orderData
      });
      
      res.json({ 
        success: false,
        orderStatus: 'PAID',
        paymentStatus: orderData.payment_status,
        amount: orderData.order_amount,
        message: 'Payment is still being processed'
      });
      
    } else {
      res.json({ 
        success: false,
        orderStatus: orderData.order_status || 'NOT_CREATED',
        paymentStatus: orderData.payment_status || 'NOT_ATTEMPTED',
        amount: orderData.order_amount || 0,
        message: 'Payment was not completed successfully'
      });
    }
    
  } catch (error) {
    console.error('Payment status check error:', error.response?.data || error.message);
    
    res.status(500).json({ 
      error: 'Payment status check failed', 
      details: error.response?.data || error.message
    });
  }
};

// Raise ticket for incomplete payment with image upload
const raiseTicket = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { description } = req.body;
    const uploadedImages = [];

    console.log(`Raising ticket for order: ${orderId}`);
    console.log(`Description: ${description}`);
    console.log(`Files received: ${req.files ? req.files.length : 0}`);

    // Validate required fields
    if (!description || !description.trim()) {
      return res.status(400).json({ 
        success: false, 
        error: "Description is required" 
      });
    }

    // Find the incomplete payment
    const incompletePayment = await IncompletePayment.findOne({ orderId });
    if (!incompletePayment) {
      return res.status(404).json({ 
        success: false, 
        error: "Incomplete payment not found" 
      });
    }

    // Process uploaded images
    if (req.files && req.files.length > 0) {
      console.log(`Processing ${req.files.length} images...`);
      
      for (const file of req.files) {
        try {
          // Upload to ImageKit
          const ImageKit = require('imagekit');
          const imagekit = new ImageKit({
            publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
            privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
            urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
          });

          const uploadResponse = await imagekit.upload({
            file: file.buffer,
            fileName: `ticket_${orderId}_${Date.now()}_${file.originalname}`,
            folder: `/incomplete-payment-tickets/${orderId}`,
          });

          uploadedImages.push({
            url: uploadResponse.url,
            fileId: uploadResponse.fileId,
            name: file.originalname,
            size: file.size
          });

          console.log(`Image uploaded successfully: ${uploadResponse.url}`);
        } catch (uploadError) {
          console.error('Image upload failed:', uploadError);
          // Continue with other images even if one fails
        }
      }
    }

    // Update the incomplete payment with ticket information
    incompletePayment.userTicket = {
      description: description.trim(),
      images: uploadedImages,
      ticketRaised: true,
      ticketRaisedAt: new Date()
    };

    incompletePayment.ticketRaised = true;
    incompletePayment.ticketRaisedAt = new Date();

    await incompletePayment.save();

    console.log(`Ticket raised successfully for order: ${orderId}`);

    res.json({
      success: true,
      message: "Ticket raised successfully",
      data: {
        orderId: incompletePayment.orderId,
        description: incompletePayment.userTicket.description,
        images: incompletePayment.userTicket.images,
        ticketRaisedAt: incompletePayment.ticketRaisedAt
      }
    });

  } catch (error) {
    console.error('Error raising ticket:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to raise ticket",
      message: error.message 
    });
  }
};

// Helper function to save incomplete payments
const saveIncompletePayment = async (paymentData) => {
  try {
    const {
      orderId,
      transactionId,
      amount,
      customerDetails,
      paymentMethod,
      paymentStatusFromGateway,
      orderStatusFromGateway,
      gatewayResponse,
      userId // Add userId parameter
    } = paymentData;

    // Check if this incomplete payment already exists
    const existingRecord = await IncompletePayment.findOne({ orderId });
    if (existingRecord) {
      console.log(`Incomplete payment record already exists for order: ${orderId}`);
      return existingRecord;
    }

    // Create new incomplete payment record
    const incompletePayment = new IncompletePayment({
      orderId,
      transactionId,
      amount,
      customerDetails,
      userId, // Add userId to the record
      paymentMethod,
      paymentStatusFromGateway,
      orderStatusFromGateway,
      gatewayResponse
    });

    const savedRecord = await incompletePayment.save();
    console.log(`Saved incomplete payment record for order: ${orderId}`);
    return savedRecord;
  } catch (error) {
    console.error('Error saving incomplete payment record:', error);
    // Don't throw error as this is a secondary operation
  }
};

// Helper function to process successful payment
const processSuccessfulPayment = async ({ orderId, paymentId, orderAmount, paymentData }) => {
  try {
    console.log('=== STARTING PAYMENT PROCESSING ===');
    console.log('Payment data received:', { orderId, paymentId, orderAmount });

    // Check if transaction already exists to prevent duplicates
    const existingTransaction = await Transaction.findOne({ orderno: orderId });
    if (existingTransaction && (existingTransaction.status === 'TXN_SUCCESS' || existingTransaction.status === 'SUCCESS' || existingTransaction.status === 'success')) {
      console.log(`Transaction for order ${orderId} already exists and is successful`);
      return;
    }

    // Extract customer email from payment data to find user (more reliable than mobile)
    const customerEmail = paymentData.customer_details?.customer_email;
    
    if (!customerEmail) {
      throw new Error('Customer email not found in payment data');
    }

    console.log(`Searching for user profile with email: ${customerEmail}`);
    // Find user profile by email (more reliable and unique than mobile number)
    const userProfile = await Profile.findOne({ email_id: customerEmail });
    if (!userProfile) {
      // Log all available email addresses in the database for debugging
      console.log('User profile not found with email. Logging sample emails from database:');
      const sampleProfiles = await Profile.find({}, { email_id: 1, registration_no: 1 }).limit(10);
      console.log('Sample profiles:', sampleProfiles.map(p => ({ email: p.email_id, reg: p.registration_no })));
      
      throw new Error(`User profile not found for email: ${customerEmail}`);
    }
    console.log(`Found user profile: ${userProfile.registration_no}`);
    console.log(`User profile email in DB: ${userProfile.email_id}`);

    console.log(`Searching for user account with registration number: ${userProfile.registration_no}`);
    // Find user account by registration number
    const userAccount = await UserModel.findOne({ ref_no: userProfile.registration_no });
    if (!userAccount) {
      // Also try to find by username (email) as fallback
      console.log(`Trying to find user account by username: ${customerEmail}`);
      const userAccountByEmail = await UserModel.findOne({ username: customerEmail });
      if (userAccountByEmail) {
        console.log(`Found user account by email: ${userAccountByEmail.user_id}`);
      } else {
        throw new Error(`User account not found for registration: ${userProfile.registration_no} or email: ${customerEmail}`);
      }
    } else {
      console.log(`Found user account: ${userAccount.user_id}`);
    }

    // Extract order metadata
    let orderTags = {};
    try {
      // Try to get metadata from order_tags (object with string values)
      if (paymentData.order?.order_tags && typeof paymentData.order.order_tags === 'object') {
        orderTags = paymentData.order.order_tags;
      } else if (paymentData.order?.order_note) {
        // Fallback to order_note with proper HTML entity decoding
        let orderNote = paymentData.order.order_note;
        // Decode HTML entities if present
        orderNote = orderNote.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        orderTags = JSON.parse(orderNote);
      }
    } catch (error) {
      console.warn('Failed to parse order metadata:', error.message);
      console.warn('Order note content:', paymentData.order?.order_note);
      orderTags = {};
    }
    const planType = orderTags.planType || 'silver';
    const promocode = orderTags.promocode;
    const originalAmount = orderTags.originalAmount || orderAmount;
    
    console.log('Order metadata:', { planType, promocode, originalAmount });
    console.log('Payment details:', { 
      orderAmount, 
      originalAmount, 
      discount: promocode ? (originalAmount - orderAmount) : 0 
    });

    // Determine user type and subscription duration
    let userType, monthsToAdd, paidUserType;
    if (planType === 'premium') {
      userType = 'PremiumUser';
      paidUserType = 'PremiumUser';
      monthsToAdd = 12;
    } else {
      userType = 'SilverUser';
      paidUserType = 'SilverUser';
      monthsToAdd = 6;
    }

    // Calculate new expiry date
    const currentDate = new Date();
    const expiryDate = new Date(currentDate);
    expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);
    const formattedExpiryDate = expiryDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    console.log('Subscription details:', { userType, paidUserType, monthsToAdd, formattedExpiryDate });

    // Create transaction record
    const transaction = new Transaction({
      registration_no: userProfile.registration_no,
      PG_id: paymentId,
      bank_ref_num: paymentData.payment?.bank_reference || '',
      mode: paymentData.payment?.payment_method || 'UPI',
      amount: orderAmount,
      status: 'SUCCESS',
      orderno: orderId,
      usertype: paidUserType,
      promocode: promocode,
      discount_applied: promocode ? (originalAmount - orderAmount) : 0,
      original_amount: originalAmount
    });

    await transaction.save();
    console.log(`Transaction saved with ID: ${transaction.transcation_id}`);
    console.log('Transaction data:', {
      registration_no: transaction.registration_no,
      amount: transaction.amount,
      status: transaction.status,
      orderno: transaction.orderno,
      original_amount: transaction.original_amount,
      discount_applied: transaction.discount_applied
    });

    // IMPORTANT: Do NOT automatically activate the account
    // Admin should manually verify and activate the account
    // Only update expiry date and user type, but keep status as inactive
    
    // Update user profile with better error handling
    console.log(`Updating user profile for registration: ${userProfile.registration_no}`);
    const profileUpdateResult = await Profile.findOneAndUpdate(
      { registration_no: userProfile.registration_no },
      {
        expiry_date: formattedExpiryDate,
        // Keep status as is (inactive) - admin will activate after verification
        type_of_user: userType
      },
      { new: true, runValidators: true }
    );
    
    if (profileUpdateResult) {
      console.log(`User profile updated successfully for registration: ${userProfile.registration_no}`);
      console.log('Updated profile data:', {
        expiry_date: profileUpdateResult.expiry_date,
        status: profileUpdateResult.status,
        type_of_user: profileUpdateResult.type_of_user
      });
      
      // Verify the update was saved by reading it back
      const verifyProfile = await Profile.findOne({ registration_no: userProfile.registration_no });
      console.log('Verified profile data after update:', {
        expiry_date: verifyProfile.expiry_date,
        status: verifyProfile.status,
        type_of_user: verifyProfile.type_of_user
      });
    } else {
      console.warn(`User profile not found for update with registration: ${userProfile.registration_no}`);
      // Try to find the profile again to see what's happening
      const checkProfile = await Profile.findOne({ registration_no: userProfile.registration_no });
      console.log('Profile check result:', checkProfile);
    }

    // Update user account with better error handling
    console.log(`Updating user account for registration: ${userProfile.registration_no}`);
    const accountUpdateResult = await UserModel.findOneAndUpdate(
      { ref_no: userProfile.registration_no },
      {
        // Keep status as is (inactive) - admin will activate after verification
        user_role: userType
      },
      { new: true, runValidators: true }
    );
    
    if (accountUpdateResult) {
      console.log(`User account updated successfully for registration: ${userProfile.registration_no}`);
      console.log('Updated account data:', {
        status: accountUpdateResult.status,
        user_role: accountUpdateResult.user_role
      });
      
      // Verify the update was saved by reading it back
      const verifyAccount = await UserModel.findOne({ ref_no: userProfile.registration_no });
      console.log('Verified account data after update:', {
        status: verifyAccount.status,
        user_role: verifyAccount.user_role
      });
    } else {
      console.warn(`User account not found for update with registration: ${userProfile.registration_no}`);
      // Try to find the account again to see what's happening
      const checkAccount = await UserModel.findOne({ ref_no: userProfile.registration_no });
      console.log('Account check result:', checkAccount);
    }

    console.log(`User ${userProfile.registration_no} upgraded to ${userType} (status remains inactive for admin verification)`);

    // Send payment success email to user
    try {
      const { sendMail } = require('../utils/EmailService');
      const { getUserPaymentSuccessMessage } = require('../utils/EmailMessages');
      
      const { paymentSuccessMessage, paymentSuccessSubject } = getUserPaymentSuccessMessage(
        userProfile,
        planType,
        formattedExpiryDate,
        orderId,
        orderAmount,
        originalAmount // Pass original amount for email template
      );
      
      await sendMail(userProfile.email_id, paymentSuccessSubject, paymentSuccessMessage);
      console.log(`Payment success email sent to user: ${userProfile.email_id}`);
    } catch (emailError) {
      console.error('Error sending payment success email to user:', emailError);
    }

    // Handle promoter earnings if promocode was used
    if (promocode) {
      console.log('Processing promoter earning for promocode:', promocode);
      await createPromoterEarning({
        promocode: promocode,
        userRegistrationNo: userProfile.registration_no,
        userEmail: userProfile.email_id,
        userMobile: userProfile.mobile_no,
        transactionNo: paymentId,
        userType: paidUserType
      });
    } else {
      console.log('No promocode used, skipping promoter earning');
    }

    console.log('=== PAYMENT PROCESSING COMPLETED ===');

  } catch (error) {
    console.error('Error processing successful payment:', error);
    throw error;
  }
};

// Helper function to process failed payment
const processFailedPayment = async ({ orderId, paymentId, paymentStatus, paymentData }) => {
  try {
    const customerPhone = paymentData.customer_details?.customer_phone;
    
    if (customerPhone) {
      const userProfile = await Profile.findOne({ mobile_no: customerPhone });
      
      if (userProfile) {
        // Create failed transaction record
        const transaction = new Transaction({
          registration_no: userProfile.registration_no,
          PG_id: paymentId,
          amount: paymentData.order?.order_amount || 0,
          status: 'FAILURE',
          orderno: orderId,
          usertype: 'SilverUser', // Default for failed transactions
          original_amount: paymentData.order?.order_amount || 0
        });

        await transaction.save();
        console.log(`Failed transaction saved for order: ${orderId}`);
      }
    }
  } catch (error) {
    console.error('Error processing failed payment:', error);
  }
};

// Helper function to create promoter earning record
const createPromoterEarning = async ({ promocode, userRegistrationNo, userEmail, userMobile, transactionNo, userType }) => {
  try {
    console.log('=== STARTING PROMOTER EARNING CREATION ===');
    console.log('Input parameters:', {
      promocode,
      userRegistrationNo,
      userEmail,
      userMobile,
      transactionNo,
      userType
    });

    // Validate required parameters
    if (!promocode || !userRegistrationNo || !userEmail || !userMobile || !transactionNo || !userType) {
      console.error('Missing required parameters for promoter earning creation');
      return;
    }

    // Find user profile to get user details
    const userProfile = await Profile.findOne({ registration_no: userRegistrationNo });
    if (!userProfile) {
      console.error('User profile not found for registration:', userRegistrationNo);
      return;
    }

    // Find promoter details (convert promocode to uppercase as done in promocheck)
    const promoter = await PromotersModel.findOne({ 
      promoter_id: { $regex: new RegExp("^" + promocode.trim() + "$", "i") }
    });
    
    if (!promoter) {
      console.log('=== [CONSLODE LOG: PROMOTER ERROR] Active promoter not found for promocode:', promocode.toUpperCase(), '===');
      return;
    }
    
    console.log('=== [CONSLODE LOG: PROMOTER FOUND] Found promoter for earning creation:', promoter.promoter_id, '| Name:', promoter.promoter_name, '===');

    // Check if an earning record already exists for this user registration number
    const existingEarning = await PromotersEarningsModel.findOne({ ref_no: userRegistrationNo });
    if (existingEarning) {
      console.log('=== [CONSLODE LOG: EARNING EXISTS] Promoter earning already exists for registration:', userRegistrationNo, '| Amount:', existingEarning.amount_earned, '===');
      return existingEarning;
    }

    // Generate ID for the new earning record
    let nextId = "1";
    try {
      const lastEarning = await PromotersEarningsModel.findOne({}, {}, { sort: { 'id': -1 } });
      if (lastEarning && !isNaN(parseInt(lastEarning.id))) {
        nextId = (parseInt(lastEarning.id) + 1).toString();
      }
    } catch (idError) {
      console.error('Error generating ID:', idError);
      // Fallback to timestamp-based ID
      nextId = Date.now().toString();
    }
    
    console.log('Generated ID:', nextId);

    // Create and save the earning record
    const earningData = {
      id: nextId,
      referal_by: promocode.toUpperCase(),
      ref_no: userRegistrationNo,
      emailid: promoter ? promoter.email : userEmail,
      mobile: promoter ? promoter.mobile : userMobile,
      promoter_name: promoter ? promoter.promoter_name : '',
      account_number: promoter ? (promoter.account_number || '') : '',
      bank_ifsc: promoter ? (promoter.bank_ifsc || '') : '',
      user_email: userEmail,
      user_mobile: userMobile,
      amount_earned: '100',  // Fixed amount for now
      transaction_no: transactionNo,
      status: 'pending',
      usertype: userType
    };

    console.log('Creating earning with data:', earningData);
    
    // Using create method instead of new + save
    const savedEarning = await PromotersEarningsModel.create(earningData);
    console.log('=== [CONSLODE LOG: PROMOTER EARNING SUCCESS] Added ₹100 inside promoter earnings table (promoters_earnings_tbl) for Promoter:', promocode.toUpperCase(), '| User:', userRegistrationNo, '===');

    // Also store the transaction in promoters_transaction_tbl
    try {
      const existingPromoterTxn = await PromoterTransactionModel.findOne({ transaction_no: transactionNo });
      if (!existingPromoterTxn) {
        let nextPromoterTxnId = "1";
        const lastPromoterTxn = await PromoterTransactionModel.findOne({}, {}, { sort: { 'id': -1 } });
        if (lastPromoterTxn && !isNaN(parseInt(lastPromoterTxn.id))) {
          nextPromoterTxnId = (parseInt(lastPromoterTxn.id) + 1).toString();
        }
        await PromoterTransactionModel.create({
          id: nextPromoterTxnId,
          promocode: promocode.toUpperCase(),
          transaction_no: transactionNo || Date.now().toString(),
          transaction_date: new Date().toISOString().split('T')[0],
          amount: "100",
          mode_of_payment: "Online/System",
          status: "active"
        });
        console.log(`=== [CONSLODE LOG: PROMOTER TXN SUCCESS] Added ₹100 inside promoter transaction table (promoters_transaction_tbl) for Promoter: ${promocode.toUpperCase()} ===`);
      }
    } catch (promoterTxnErr) {
      console.error('=== [CONSLODE LOG ERROR] Error saving to promoters_transaction_tbl:', promoterTxnErr, '===');
    }

    // Send email to promoter
    try {
      const { sendMail } = require('../utils/EmailService');
      const { getPromoterPaymentSuccessMessage } = require('../utils/EmailMessages');
      
      const { promoterPaymentSuccessMessage, promoterPaymentSuccessSubject } = getPromoterPaymentSuccessMessage(
        promoter,
        userProfile,
        transactionNo,
        '100'
      );
      
      await sendMail(promoter.email, promoterPaymentSuccessSubject, promoterPaymentSuccessMessage);
      console.log('Promoter email sent to:', promoter.email);
    } catch (emailError) {
      console.error('Error sending promoter email:', emailError);
    }

    console.log('=== PROMOTER EARNING CREATION COMPLETED ===');
    return savedEarning;

  } catch (error) {
    console.error('Error in createPromoterEarning:', error);
    console.error('Error stack:', error.stack);
  }
};

// Helper function to credit promoter when admin upgrades or activates a user
const creditPromoterOnAdminAction = async (profile, transactionNo, userType) => {
  try {
    if (!profile || !profile.registration_no) {
      return;
    }
    let targetType = userType || profile.type_of_user;
    const lowerType = (targetType || "").toLowerCase();
    if (lowerType === "silveruser" || lowerType === "silver" || lowerType === "paidsilver" || lowerType.includes("silver")) {
      targetType = "SilverUser";
    } else if (lowerType === "premiumuser" || lowerType === "premium" || lowerType === "paidpremium" || lowerType.includes("premium")) {
      targetType = "PremiumUser";
    }

    if (targetType !== "SilverUser" && targetType !== "PremiumUser") {
      return;
    }

    // Ensure user transaction is updated/stored in transaction_tbl as active/TXN_SUCCESS
    try {
      const existingTxn = await Transaction.findOne({ registration_no: profile.registration_no });
      if (existingTxn) {
        await Transaction.updateOne({ registration_no: profile.registration_no }, {
          $set: {
            status: "SUCCESS",
            is_handled: true,
            usertype: targetType,
            promocode: profile.refered_by || existingTxn.promocode || null
          }
        });
        console.log(`=== [CONSLODE LOG: ADMIN ACTIVATION] User ${profile.registration_no} activated by admin! Updated existing transaction in transaction_tbl from PENDING to SUCCESS (Active) ===`);
      } else {
        let finalAmount = 799;
        if (targetType === "PremiumUser") finalAmount = 999;
        
        const lastTrans = await Transaction.findOne({}).sort({ transaction_id: -1, transcation_id: -1 }).lean();
        const lastId = lastTrans?.transaction_id || lastTrans?.transcation_id || 0;
        const nextId = Number(lastId) + 1;

        const newTxn = new Transaction({
          registration_no: profile.registration_no,
          transaction_id: nextId,
          transcation_id: nextId,
          PG_id: transactionNo || Date.now().toString(),
          bank_ref_num: transactionNo || Date.now().toString(),
          mode: "Admin Approval",
          amount: finalAmount,
          status: "SUCCESS",
          orderno: transactionNo || Date.now().toString(),
          usertype: targetType,
          promocode: profile.refered_by || null,
          discount_applied: 0,
          original_amount: finalAmount,
          is_handled: true
        });
        await newTxn.save();
        console.log(`=== [CONSLODE LOG: ADMIN ACTIVATION] User ${profile.registration_no} activated by admin! Created new active transaction in transaction_tbl ===`);
      }
    } catch (txnErr) {
      console.error("=== [CONSLODE LOG ERROR] Error storing transaction in transaction_tbl:", txnErr, "===");
    }

    let promoCode = profile.refered_by;
    if (!promoCode || !promoCode.trim()) {
      const userDoc = await UserModel.findOne({ ref_no: profile.registration_no }).lean();
      if (userDoc && userDoc.refered_by) {
        promoCode = userDoc.refered_by;
      }
    }

    if (!promoCode || !promoCode.trim()) {
      console.log(`=== [CONSLODE LOG: NO PROMOTER] User ${profile.registration_no} has no refered_by promocode. No promoter earning to credit ===`);
      return;
    }
    console.log(`=== [CONSLODE LOG: CREDITING PROMOTER] Triggering createPromoterEarning for user ${profile.registration_no} (${targetType}) with promocode: ${promoCode} ===`);
    await createPromoterEarning({
      promocode: promoCode,
      userRegistrationNo: profile.registration_no,
      userEmail: profile.email_id || "admin_action@example.com",
      userMobile: profile.mobile_no || profile.phone || "0000000000",
      transactionNo: transactionNo || Date.now().toString(),
      userType: targetType
    });
  } catch (err) {
    console.error("=== [CONSLODE LOG ERROR] Error in creditPromoterOnAdminAction:", err, "===");
  }
};

module.exports = {
  createOrder,
  verifyPayment,
  getIncompletePayment,
  handleWebhook,
  retryPayment,
  handlePaymentRedirect,
  checkPaymentStatus,
  raiseTicket,
  saveIncompletePayment,
  processSuccessfulPayment,
  processFailedPayment,
  createPromoterEarning,
  creditPromoterOnAdminAction
};