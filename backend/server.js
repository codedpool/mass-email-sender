const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const csvParser = require("csv-parser");
const fs = require("fs");
const path = require("path");
const emailValidator = require("email-validator");
const { v4: uuidv4 } = require("uuid");
const schedule = require("node-schedule");
const mongoose = require("mongoose");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
require("dotenv").config(); // Load environment variables

const app = express();
const cors = require("cors");
const upload = multer({ dest: "uploads/" });

// Define frontend and backend URLs
const FRONTEND_URL = "https://mailer1-d1qw.onrender.com";
const BACKEND_URL = "https://mailer-backend-7ay3.onrender.com";

app.use(express.json());
app.use(cors());

// Session setup for Passport
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Debugging: Log the MongoDB connection string
console.log("MONGODB_URI:", process.env.MONGODB_URI);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1); // Exit the application if MongoDB connection fails
  });

// Define User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  emailService: { type: String, required: true }, // e.g., "gmail"
  accessToken: { type: String, required: true },
  refreshToken: { type: String },
});

const User = mongoose.model("User", userSchema);

// Define Campaign Schema
const campaignSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Link to user
  subject: String,
  recipients: [
    {
      email: String,
      status: { type: String, default: "Not Sent" },
      opened: { type: Boolean, default: false },
      linkVisited: { type: Boolean, default: false },
      trackingId: String,
    },
  ],
});

const Campaign = mongoose.model("Campaign", campaignSchema);

// Passport Google OAuth2 Configuration
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Save or update user in the database
        const user = await User.findOneAndUpdate(
          { email: profile.emails[0].value },
          {
            email: profile.emails[0].value,
            emailService: "gmail",
            accessToken,
            refreshToken,
          },
          { upsert: true, new: true }
        );
        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

// Serialize and deserialize user
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth2 login route
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email", "https://www.googleapis.com/auth/gmail.send"],
  })
);

// Google OAuth2 callback route
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // Redirect to the frontend dashboard after successful login
    res.redirect(`${FRONTEND_URL}/dashboard`);
  }
);

// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).send({ message: "Unauthorized" });
};

// Handle sending emails
app.post("/send-email", isAuthenticated, upload.fields([{ name: "csvFile" }, { name: "contentFile" }]), async (req, res) => {
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
      const uniqueRecipients = Array.from(new Set(recipients));
      const campaignId = uuidv4();

      // Create a new campaign in MongoDB
      const newCampaign = new Campaign({
        userId: req.user._id, // Link campaign to the logged-in user
        subject,
        recipients: uniqueRecipients.map((recipient) => ({
          email: recipient.email,
          trackingId: uuidv4(),
        })),
      });

      await newCampaign.save();

      let emailContent = manualText || "";

      if (contentFile) {
        emailContent = fs.readFileSync(path.join(__dirname, contentFile.path), "utf-8");
      }

      // Use the user's access token to send emails
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          type: "OAuth2",
          user: req.user.email, // User's email
          accessToken: req.user.accessToken, // User's access token
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          refreshToken: req.user.refreshToken,
        },
      });

      for (const recipient of uniqueRecipients) {
        const personalizedContent = replacePersonalizationTags(emailContent, recipient);
        const recipientData = newCampaign.recipients.find((r) => r.email === recipient.email);
        const trackingId = recipientData.trackingId;

        const trackingPixel = `<img src="${BACKEND_URL}/track/${trackingId}" width="1" height="1" style="display:none;" />`;
        const trackedLink = `${BACKEND_URL}/click/${trackingId}`;
        const unsubscribeLink = `<p>If you wish to unsubscribe, click <a href="${BACKEND_URL}/unsubscribe/${encodeURIComponent(
          recipient.email
        )}">here</a>.</p>`;

        const finalHtml = `${personalizedContent}<p>Click <a href="${trackedLink}">here</a> to visit the link.</p>${trackingPixel}${unsubscribeLink}`;

        const mailOptions = {
          from: req.user.email, // Use the user's email as the sender
          to: recipient.email,
          subject,
          text: personalizedContent, // Plain text fallback
          html: finalHtml,
        };

        if (isScheduled === "true") {
          const scheduleDate = new Date(sendAt);
          schedule.scheduleJob(scheduleDate, async () => {
            try {
              const result = await transporter.sendMail(mailOptions);
              console.log(`Scheduled email sent successfully to ${recipient.email}`, result);
              recipientData.status = "Sent";
              await newCampaign.save();
            } catch (error) {
              console.error(`Error sending scheduled email to ${recipient.email}:`, error.message);
            }
          });
        } else {
          try {
            const result = await transporter.sendMail(mailOptions);
            console.log(`Email sent successfully to ${recipient.email}`, result);
            recipientData.status = "Sent";
            await newCampaign.save();
          } catch (error) {
            console.error(`Error sending email to ${recipient.email}:`, error.message);
          }
        }
      }

      // Cleanup uploaded files
      fs.unlinkSync(filePath);
      if (contentFile) fs.unlinkSync(path.join(__dirname, contentFile.path));

      res.status(200).send({ message: "Emails processed successfully!", campaignId: newCampaign._id });
    })
    .on("error", (err) => {
      console.error("Error processing CSV file:", err);
      res.status(500).send({ message: "Error processing CSV file." });
    });
});

// Track email open (tracking pixel)
app.get("/track/:trackingId", async (req, res) => {
  const trackingId = req.params.trackingId;
  console.log(`Email opened. Tracking ID: ${trackingId}`);

  // Update recipient's opened status in MongoDB
  const campaign = await Campaign.findOne({ "recipients.trackingId": trackingId });
  if (campaign) {
    const recipient = campaign.recipients.find((r) => r.trackingId === trackingId);
    if (recipient) {
      recipient.opened = true;
      await campaign.save();
    }
  }

  res.sendFile(path.join(__dirname, "tracking-pixels.png"));
});

// Handle click tracking
app.get("/click/:trackingId", async (req, res) => {
  const trackingId = req.params.trackingId;
  console.log(`Link clicked. Tracking ID: ${trackingId}`);

  // Update recipient's linkVisited status in MongoDB
  const campaign = await Campaign.findOne({ "recipients.trackingId": trackingId });
  if (campaign) {
    const recipient = campaign.recipients.find((r) => r.trackingId === trackingId);
    if (recipient) {
      recipient.linkVisited = true;
      await campaign.save();
    }
  }

  res.redirect(FRONTEND_URL);
});

// Fetch tracking reports
app.get("/tracking-reports", isAuthenticated, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id }); // Fetch campaigns for the logged-in user

    // Calculate CTR and OTR for each campaign
    const trackingReports = campaigns.map((campaign) => {
      const totalEmailsSent = campaign.recipients.length;
      const totalOpened = campaign.recipients.filter((r) => r.opened).length;
      const totalClicks = campaign.recipients.filter((r) => r.linkVisited).length;

      const ctr = totalEmailsSent > 0 ? ((totalClicks / totalEmailsSent) * 100).toFixed(2) : 0;
      const otr = totalEmailsSent > 0 ? ((totalOpened / totalEmailsSent) * 100).toFixed(2) : 0;

      return {
        _id: campaign._id,
        subject: campaign.subject,
        ctr: parseFloat(ctr), // Convert string to number
        otr: parseFloat(otr), // Convert string to number
      };
    });

    res.status(200).json({ trackingReports });
  } catch (error) {
    console.error("Error fetching tracking reports:", error);
    res.status(500).send({ message: "An error occurred while fetching tracking reports." });
  }
});

// Fetch campaign details
app.get("/campaign-details/:campaignId", isAuthenticated, async (req, res) => {
  const campaignId = req.params.campaignId;

  // Validate campaignId
  if (!mongoose.Types.ObjectId.isValid(campaignId)) {
    return res.status(400).send({ message: "Invalid campaign ID." });
  }

  try {
    const campaign = await Campaign.findOne({ _id: campaignId, userId: req.user._id }); // Ensure the campaign belongs to the logged-in user
    if (!campaign) {
      return res.status(404).send({ message: "Campaign not found." });
    }
    res.status(200).json(campaign);
  } catch (error) {
    console.error("Error fetching campaign details:", error);
    res.status(500).send({ message: "An error occurred while fetching campaign details." });
  }
});

// Handle unsubscribe
app.get("/unsubscribe/:email", (req, res) => {
  const email = decodeURIComponent(req.params.email);
  console.log(`Unsubscribe request received for email: ${email}`);
  res.send(`You have unsubscribed from emails sent to ${email}`);
});

// Start the server
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});