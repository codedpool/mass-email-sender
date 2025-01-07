import React, { useState } from "react";

const backendUrl = "https://mass-email-sender-backend.onrender.com"; 

const EmailSender = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [contentFile, setContentFile] = useState(null);
  const [manualText, setManualText] = useState("");
  const [subject, setSubject] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [status, setStatus] = useState("");

  const handleSendEmail = async () => {
    if (!csvFile) {
      setStatus("Please upload a CSV file with recipients.");
      return;
    }

    if (!manualText && !contentFile) {
      setStatus("Please provide content: enter text or upload an HTML/Markdown file.");
      return;
    }

    if (manualText && contentFile) {
      setStatus("You can only use one content option: text or HTML/Markdown file.");
      return;
    }

    if (isScheduled) formData.append("sendAt", scheduleDate);


    const formData = new FormData();
    formData.append("csvFile", csvFile);
    formData.append("contentFile", contentFile);
    formData.append("manualText", manualText);
    formData.append("subject", subject);
    formData.append("isScheduled", isScheduled);
    if (isScheduled) formData.append("sendAt", scheduleDate);

    try {
      const response = await fetch(`${backendUrl}/send-email`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setStatus(data.message || "Emails sent successfully!");
      } else {
        setStatus(data.message || "Error sending email");
      }
    } catch (error) {
      setStatus("An error occurred while sending the email.");
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "auto", padding: "20px" }}>
      <h1>Email Sender</h1>

      {/* CSV Upload */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="csvUpload" style={{ display: "block", fontWeight: "bold" }}>
          Upload CSV File with Recipients:
        </label>
        <input
          id="csvUpload"
          type="file"
          onChange={(e) => setCsvFile(e.target.files[0])}
          accept=".csv"
          style={{ marginBottom: "10px", padding: "8px" }}
        />
        <small style={{ color: "#555" }}>Please upload a CSV file with email addresses and personalized fields.</small>
      </div>

      {/* Subject */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="subject" style={{ display: "block", fontWeight: "bold" }}>
          Email Subject:
        </label>
        <input
          id="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Enter email subject"
          style={{ width: "100%", padding: "10px", marginBottom: "10px" }}
        />
      </div>

      {/* Email Content */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="manualText" style={{ display: "block", fontWeight: "bold" }}>
          Email Content (Text):
        </label>
        <textarea
          id="manualText"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Enter your email content here"
          rows="5"
          style={{ width: "100%", padding: "10px", marginBottom: "10px" }}
        />
      </div>

      {/* HTML/Markdown File Upload */}
      <div style={{ marginBottom: "20px" }}>
        <label htmlFor="contentFile" style={{ display: "block", fontWeight: "bold" }}>
          Or Upload HTML/Markdown File:
        </label>
        <input
          id="contentFile"
          type="file"
          onChange={(e) => setContentFile(e.target.files[0])}
          accept=".html,.md"
          style={{ marginBottom: "10px", padding: "8px" }}
        />
      </div>

      {/* Schedule Email Option */}
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center" }}>
        <label htmlFor="scheduleEmail" style={{ fontWeight: "bold" }}>
          Schedule Email:
        </label>
        <input
          id="scheduleEmail"
          type="checkbox"
          checked={isScheduled}
          onChange={() => setIsScheduled(!isScheduled)}
          style={{ marginLeft: "10px" }}
        />
      </div>

      {/* Date and Time Picker for Scheduled Emails */}
      {isScheduled && (
        <div style={{ marginBottom: "20px" }}>
          <label htmlFor="scheduleDate" style={{ display: "block", fontWeight: "bold" }}>
            Select Date and Time:
          </label>
          <input
            id="scheduleDate"
            type="datetime-local"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            style={{ width: "100%", padding: "10px", marginBottom: "10px" }}
          />
        </div>
      )}

      {/* Submit Button */}
      <button onClick={handleSendEmail} style={{ width: "100%", padding: "10px", backgroundColor: "#4CAF50", color: "white", border: "none", cursor: "pointer" }}>
        Send Email
      </button>

      {/* Status Message */}
      <p style={{ marginTop: "20px", fontSize: "16px", color: "#555" }}>
        {status}
      </p>
    </div>
  );
};

export default EmailSender;
