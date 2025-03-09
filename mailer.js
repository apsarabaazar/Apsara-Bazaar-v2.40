const nodemailer = require("nodemailer");
require("dotenv").config();

// Nodemailer setup for sending emails (for OTP only)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // Your email address
    pass: process.env.GMAIL_PASS, // Your app password
  },
});

// Function to send an email (OTP)
const sendEmail = (email) => transporter.sendMail(email);

// Export the sendEmail function for OTP sending
module.exports = {
  sendEmail,
};
