const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const sendMail = async (email, subject, htmlContent) => {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error("Invalid or missing recipient email:", email);
    return;
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.EMAIL_USER.trim() || !process.env.EMAIL_PASS.trim()) {
    console.log(`=== [EMAIL SKIPPED] Email credentials (EMAIL_USER / EMAIL_PASS) are not set in .env file. Could not send "${subject}" to ${email} ===`);
    return;
  }

  try {
    const mailOptions = {
      from: `"Girijakalyana" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
       html: htmlContent,
    };

   
    await transporter.sendMail(mailOptions);
    console.log(`=== [EMAIL SENT] Successfully sent "${subject}" to ${email} ===`);
   
  } catch (error) {
    console.error("=== [EMAIL ERROR] Error sending email:", error.message || error, "===");
  }
};

module.exports = { sendMail };