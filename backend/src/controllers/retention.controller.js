/**
 * Virtex Admin - Member Retention and Communication Expansion Controller
 * REST endpoints for Email Templates, Push Notification Campaigns, Member Announcements,
 * Automated Renewal Reminders, Inactive Member Follow-ups, Member Feedback (NPS),
 * Complaint Management, Communication History, Audience Segmentation, and Performance Reports.
 */

import { retentionRepository } from '../repositories/retention.repository.js';

// ==========================================
// 1. EMAIL TEMPLATES
// ==========================================
export async function getEmailTemplates(req, res) {
  try {
    const { category, search } = req.query;
    const templates = await retentionRepository.getEmailTemplates({ category, search });
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('Error fetching email templates:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve email templates' });
  }
}

export async function getEmailTemplateById(req, res) {
  try {
    const { id } = req.params;
    const template = await retentionRepository.getEmailTemplateById(id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    console.error('Error fetching template by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve email template' });
  }
}

export async function createEmailTemplate(req, res) {
  try {
    const { name, subject, body_html } = req.body;
    if (!name || !subject || !body_html) {
      return res.status(400).json({ success: false, message: 'Name, subject, and body HTML are required' });
    }
    const template = await retentionRepository.createEmailTemplate(req.body);
    res.status(201).json({ success: true, data: template, message: 'Template saved successfully' });
  } catch (err) {
    console.error('Error creating email template:', err);
    res.status(500).json({ success: false, message: 'Failed to create email template' });
  }
}

export async function updateEmailTemplate(req, res) {
  try {
    const { id } = req.params;
    const updated = await retentionRepository.updateEmailTemplate(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: updated, message: 'Template updated successfully' });
  } catch (err) {
    console.error('Error updating template:', err);
    res.status(500).json({ success: false, message: 'Failed to update email template' });
  }
}

export async function deleteEmailTemplate(req, res) {
  try {
    const { id } = req.params;
    const success = await retentionRepository.deleteEmailTemplate(id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    console.error('Error deleting template:', err);
    res.status(500).json({ success: false, message: 'Failed to delete template' });
  }
}

// ==========================================
// 2. AUDIENCE SEGMENTATION
// ==========================================
export async function getAudienceSegments(req, res) {
  try {
    const segments = await retentionRepository.getAudienceSegments();
    res.json({ success: true, data: segments });
  } catch (err) {
    console.error('Error fetching audience segments:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve audience segments' });
  }
}

export async function getSegmentMembers(req, res) {
  try {
    const { code } = req.params;
    const members = await retentionRepository.getSegmentMembers(code);
    res.json({ success: true, data: members, total: members.length });
  } catch (err) {
    console.error('Error fetching segment members:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve segment members' });
  }
}

// ==========================================
// 3. CAMPAIGNS & PUSH NOTIFICATIONS
// ==========================================
export async function getCampaigns(req, res) {
  try {
    const { type, status, search } = req.query;
    const campaigns = await retentionRepository.getCampaigns({ type, status, search });
    res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve retention campaigns' });
  }
}

export async function getCampaignById(req, res) {
  try {
    const { id } = req.params;
    const campaign = await retentionRepository.getCampaignById(id);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, data: campaign });
  } catch (err) {
    console.error('Error fetching campaign by id:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve campaign' });
  }
}

export async function createCampaign(req, res) {
  try {
    const { title, message_body } = req.body;
    if (!title || !message_body) {
      return res.status(400).json({ success: false, message: 'Title and message body are required' });
    }
    const campaign = await retentionRepository.createCampaign(req.body);
    res.status(201).json({ success: true, data: campaign, message: 'Retention campaign created' });
  } catch (err) {
    console.error('Error creating campaign:', err);
    res.status(500).json({ success: false, message: 'Failed to create campaign' });
  }
}

export async function launchCampaign(req, res) {
  try {
    const { id } = req.params;
    const launched = await retentionRepository.launchCampaign(id);
    res.json({ success: true, data: launched, message: 'Campaign dispatched to target audience segment' });
  } catch (err) {
    console.error('Error launching campaign:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to dispatch campaign' });
  }
}

// ==========================================
// 4. MEMBER ANNOUNCEMENTS
// ==========================================
export async function getMemberAnnouncements(req, res) {
  try {
    const announcements = await retentionRepository.getMemberAnnouncements();
    res.json({ success: true, data: announcements });
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve announcements' });
  }
}

export async function createMemberAnnouncement(req, res) {
  try {
    const { title, message } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }
    const created = await retentionRepository.createMemberAnnouncement(req.body);
    res.status(201).json({ success: true, data: created, message: 'Member announcement published' });
  } catch (err) {
    console.error('Error creating announcement:', err);
    res.status(500).json({ success: false, message: 'Failed to publish announcement' });
  }
}

// ==========================================
// 5. AUTOMATED RENEWAL REMINDERS
// ==========================================
export async function getExpiringMembersForRenewal(req, res) {
  try {
    const daysAhead = parseInt(req.query.daysAhead || 7, 10);
    const members = await retentionRepository.getExpiringMembersForRenewal({ daysAhead });
    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Error fetching expiring members:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve expiring members' });
  }
}

export async function sendRenewalReminder(req, res) {
  try {
    const { member_id, channel, customMessage } = req.body;
    if (!member_id) {
      return res.status(400).json({ success: false, message: 'member_id is required' });
    }
    const reminderLog = await retentionRepository.sendAutomatedRenewalReminder({ member_id, channel, customMessage });
    res.json({ success: true, data: reminderLog, message: 'Renewal reminder dispatched' });
  } catch (err) {
    console.error('Error sending renewal reminder:', err);
    res.status(500).json({ success: false, message: 'Failed to send renewal reminder' });
  }
}

// ==========================================
// 6. INACTIVE MEMBER FOLLOW-UPS
// ==========================================
export async function getInactiveMembers(req, res) {
  try {
    const daysInactive = parseInt(req.query.daysInactive || 14, 10);
    const inactives = await retentionRepository.getInactiveMembers({ daysInactive });
    res.json({ success: true, data: inactives });
  } catch (err) {
    console.error('Error fetching inactive members:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve inactive members' });
  }
}

export async function sendInactiveFollowup(req, res) {
  try {
    const { member_id, channel, message, offerCode } = req.body;
    if (!member_id) {
      return res.status(400).json({ success: false, message: 'member_id is required' });
    }
    const followupLog = await retentionRepository.sendInactiveFollowup({ member_id, channel, message, offerCode });
    res.json({ success: true, data: followupLog, message: 'Dormant member follow-up sent' });
  } catch (err) {
    console.error('Error sending inactive follow-up:', err);
    res.status(500).json({ success: false, message: 'Failed to send inactive follow-up' });
  }
}

// ==========================================
// 7. MEMBER FEEDBACK & NPS SURVEYS
// ==========================================
export async function getFeedbacks(req, res) {
  try {
    const { sentiment, category, status, search } = req.query;
    const feedbacks = await retentionRepository.getFeedbacks({ sentiment, category, status, search });
    res.json({ success: true, data: feedbacks });
  } catch (err) {
    console.error('Error fetching feedbacks:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve member feedback' });
  }
}

export async function createFeedback(req, res) {
  try {
    const { member_id, nps_score, feedback_text } = req.body;
    if (!member_id || nps_score === undefined || !feedback_text) {
      return res.status(400).json({ success: false, message: 'Member ID, NPS score, and feedback text are required' });
    }
    const created = await retentionRepository.createFeedback(req.body);
    res.status(201).json({ success: true, data: created, message: 'Feedback recorded' });
  } catch (err) {
    console.error('Error recording feedback:', err);
    res.status(500).json({ success: false, message: 'Failed to submit feedback' });
  }
}

export async function respondToFeedback(req, res) {
  try {
    const { id } = req.params;
    const { admin_response } = req.body;
    if (!admin_response) {
      return res.status(400).json({ success: false, message: 'admin_response is required' });
    }
    const updated = await retentionRepository.respondToFeedback(id, admin_response);
    res.json({ success: true, data: updated, message: 'Response saved and marked action taken' });
  } catch (err) {
    console.error('Error responding to feedback:', err);
    res.status(500).json({ success: false, message: 'Failed to respond to feedback' });
  }
}

// ==========================================
// 8. COMPLAINT MANAGEMENT TICKETS
// ==========================================
export async function getComplaints(req, res) {
  try {
    const { status, priority, category, search } = req.query;
    const complaints = await retentionRepository.getComplaints({ status, priority, category, search });
    res.json({ success: true, data: complaints });
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve complaints' });
  }
}

export async function createComplaint(req, res) {
  try {
    const { member_id, subject, description } = req.body;
    if (!member_id || !subject || !description) {
      return res.status(400).json({ success: false, message: 'Member ID, subject, and description are required' });
    }
    const created = await retentionRepository.createComplaint(req.body);
    res.status(201).json({ success: true, data: created, message: 'Complaint ticket logged successfully' });
  } catch (err) {
    console.error('Error creating complaint:', err);
    res.status(500).json({ success: false, message: 'Failed to create complaint ticket' });
  }
}

export async function updateComplaintStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, resolution_notes, assigned_to } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    const updated = await retentionRepository.updateComplaintStatus(id, { status, resolution_notes, assigned_to });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Complaint ticket not found' });
    }
    res.json({ success: true, data: updated, message: `Ticket status updated to ${status}` });
  } catch (err) {
    console.error('Error updating complaint:', err);
    res.status(500).json({ success: false, message: 'Failed to update complaint' });
  }
}

// ==========================================
// 9. COMMUNICATION HISTORY
// ==========================================
export async function getCommunicationHistory(req, res) {
  try {
    const { member_id, channel, limit } = req.query;
    const history = await retentionRepository.getCommunicationHistory({ member_id, channel, limit });
    res.json({ success: true, data: history });
  } catch (err) {
    console.error('Error fetching communication history:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve communication history' });
  }
}

export async function logCommunication(req, res) {
  try {
    const { member_id, message } = req.body;
    if (!member_id || !message) {
      return res.status(400).json({ success: false, message: 'member_id and message are required' });
    }
    const logged = await retentionRepository.logCommunication(req.body);
    res.status(201).json({ success: true, data: logged, message: 'Communication logged' });
  } catch (err) {
    console.error('Error logging communication:', err);
    res.status(500).json({ success: false, message: 'Failed to log communication' });
  }
}

// ==========================================
// 10. CAMPAIGN PERFORMANCE REPORTS & KPIS
// ==========================================
export async function getRetentionPerformanceReports(req, res) {
  try {
    const reports = await retentionRepository.getRetentionPerformanceReports();
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('Error fetching retention performance reports:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve retention reports' });
  }
}

