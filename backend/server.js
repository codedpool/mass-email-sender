const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const csvParser = require("csv-parser");
const fs = require("fs");
const path = require("path");
const emailValidator = require("email-validator");
const { v4: uuidv4 } = require("uuid");
const schedule = require("node-schedule");
require("dotenv").config();

const app = express();
const cors = require("cors");
const upload = multer({ dest: "uploads/" });

app.use(express.json());

const allowedOrigins = [
  "https://mass-email-sender.onrender.com", 
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedOrigins.includes(origin) || !origin) {
        // Allow requests with no origin (e.g., Postman, mobile apps)
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

// Set up transporter for sending emails
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper function to replace tags with recipient data
const replacePersonalizationTags = (content, recipientData) => {
  let personalizedContent = content;
  Object.keys(recipientData).forEach((key) => {
    const tag = `{{${key}}}`;
    personalizedContent = personalizedContent.replace(new RegExp(tag, "g"), recipientData[key]);
  });
  return personalizedContent;
};

// Handle sending emails
app.post("/send-email", upload.fields([{ name: "csvFile" }, { name: "contentFile" }]), async (req, res) => {
  const { subject, manualText, isScheduled, sendAt } = req.body;

  if (!req.files || !req.files.csvFile) {
    return res.status(400).send({ message: "CSV file with recipient details is required." });
  }

  const csvFile = req.files.csvFile[0];
  const contentFile = req.files.contentFile ? req.files.contentFile[0] : null;

  if (!subject) {
    return res.status(400).send({ message: "Subject is required." });
  }

  if (!manualText && !contentFile) {
    return res.status(400).send({ message: "Provide email content via text input or file upload." });
  }

  if (manualText && contentFile) {
    return res.status(400).send({ message: "Use only one content option: text or file upload." });
  }

  // Parse CSV file
  const recipients = [];
  const filePath = path.join(__dirname, csvFile.path);

  fs.createReadStream(filePath)
    .pipe(csvParser())
    .on("data", (data) => {
      if (emailValidator.validate(data.email)) {
        recipients.push(data);
      }
    })
    .on("end", async () => {
      const uniqueRecipients = recipients.filter((recipient, index, self) =>
        index === self.findIndex((r) => r.email === recipient.email)
      );
      const trackingData = [];
      let emailContent = manualText || "";

      if (contentFile) {
        emailContent = fs.readFileSync(path.join(__dirname, contentFile.path), "utf-8");
      }

      for (const recipient of uniqueRecipients) {
        const personalizedContent = replacePersonalizationTags(emailContent, recipient);
        const trackingId = uuidv4();
        const trackingPixel = `<img src="https://mass-email-sender-backend.onrender.com/track/${trackingId}" width="1" height="1" style="display:none;" />`;
        const trackedLink = `https://mass-email-sender-backend.onrender.com/click/${trackingId}`;
        const unsubscribeLink = `<p>If you wish to unsubscribe, click <a href="https://mass-email-sender-backend.onrender.com/unsubscribe/${encodeURIComponent(recipient.email)}">here</a>.</p>`;

        const finalHtml = `${personalizedContent}<p>Click <a href="${trackedLink}">here</a> to visit the link.</p>${trackingPixel}${unsubscribeLink}`;

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: recipient.email,
          subject,
          text: personalizedContent, // Plain text fallback
          html: finalHtml,
        };

        if (isScheduled === "true") {
          const scheduleDate = new Date(sendAt);
          schedule.scheduleJob(scheduleDate, function() {
            (async () => {
              try {
                const result = await transporter.sendMail(mailOptions);
                console.log(`Scheduled email sent successfully to ${recipient.email}`, result);
                trackingData.push({ recipient: recipient.email, trackingId, clickUrl: trackedLink });
              } catch (error) {
                console.error(`Error sending scheduled email to ${recipient.email}:`, error.message);
                console.error('Mail options:', mailOptions);
                console.error('Schedule date:', scheduleDate);
              }
            })();
          });
        } else {
          try {
            const result = await transporter.sendMail(mailOptions);
            console.log(`Email sent successfully to ${recipient.email}`, result);
            trackingData.push({ recipient: recipient.email, trackingId, clickUrl: trackedLink });
          } catch (error) {
            console.error(`Error sending email to ${recipient.email}:`, error.message);
          }
        }
      }

      // Cleanup uploaded files
      fs.unlinkSync(filePath);
      if (contentFile) fs.unlinkSync(path.join(__dirname, contentFile.path));

      res.status(200).send({ message: "Emails processed successfully!", trackingData });
    })
    .on("error", (err) => {
      console.error("Error processing CSV file:", err);
      res.status(500).send({ message: "Error processing CSV file." });
    });
});

// Track email open (tracking pixel)
app.get("/track/:trackingId", (req, res) => {
  const trackingId = req.params.trackingId;
  console.log(`Email opened. Tracking ID: ${trackingId}`);
  res.sendFile(path.join(__dirname, "tracking-pixels.png"));
});

// Handle click tracking
app.get("/click/:trackingId", (req, res) => {
  const trackingId = req.params.trackingId;
  console.log(`Link clicked. Tracking ID: ${trackingId}`);
  res.redirect("http://example.com");
});

// Handle unsubscribe
app.get("/unsubscribe/:email", (req, res) => {
  const email = decodeURIComponent(req.params.email);
  console.log(`Unsubscribe request received for email: ${email}`);
  res.send(`You have unsubscribed from emails sent to ${email}`);
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
