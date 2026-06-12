// services/emailService.js
// Amazon SES email service for portal invites and notifications
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const AWS_REGION   = process.env.AWS_REGION || 'us-east-1';
const FROM_EMAIL   = process.env.EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL || 'noreply@chippewavalleyhomecare.com';
const AGENCY_NAME  = process.env.AGENCY_NAME || 'Chippewa Valley Home Care';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com';

// SES authenticates via the standard AWS credential chain (AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY env vars, or an IAM role on the host). Treat email as
// configured only when credentials are actually present.
const isConfigured = !!(
  (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
  process.env.AWS_PROFILE ||
  process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
);

const ses = isConfigured ? new SESv2Client({ region: AWS_REGION }) : null;

// ── Helper ────────────────────────────────────────────────────
// throwOnError: when true, propagate SES's actual error so the route
// can surface it to the UI. Defaults to false to preserve existing fire-and-
// forget callers (password resets, portal invites, etc.) that just log.
//
// userId + eventType opt the send into per-user notification preferences:
//   - if both are set, sendEmail consults notificationPrefs.shouldNotify
//     before calling SES. Caller can pass urgent: true to bypass quiet hours.
const sendEmail = async ({ to, subject, html, userId, eventType, urgent }, { throwOnError = false } = {}) => {
  // Honor per-user prefs when caller provides the recipient's userId
  if (userId && eventType) {
    try {
      const { shouldNotify } = require('../helpers/notificationPrefs');
      const ok = await shouldNotify(userId, 'email', eventType, { urgent: !!urgent });
      if (!ok) {
        console.log('[Email] skipped per user prefs:', { userId, eventType });
        return false;
      }
    } catch { /* prefs failure → don't block transactional sends */ }
  }

  if (!isConfigured) {
    console.warn('[Email] SES not configured — skipping email to', to);
    return false;
  }

  const recipients = Array.isArray(to) ? to : [to];

  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: `${AGENCY_NAME} <${FROM_EMAIL}>`,
      Destination: { ToAddresses: recipients },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      },
    }));
    console.log('[Email] Sent to', to, '—', subject);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send to', to, ':', error.message);
    if (throwOnError) {
      throw new Error(error.message || 'SES send failed');
    }
    return false;
  }
};

// sendCriticalNotification — for things like password resets, portal invites,
// no-show alerts where the user MUST know. Tries email first; if email fails
// (SES down, recipient bounce, prefs blocked) and a phone number is provided,
// falls back to SMS via Twilio. Returns { email, sms } booleans.
//
// Caller passes a smsBody (short — 160 chars or it'll segment) suitable for
// the fallback path. Skip the SMS fallback by omitting smsTo or smsBody.
const sendCriticalNotification = async ({
  to, subject, html, smsTo, smsBody, userId, eventType = 'message',
}) => {
  let emailOk = false, smsOk = false;
  try {
    emailOk = await sendEmail({ to, subject, html, userId, eventType, urgent: true });
  } catch (e) { console.error('[Critical] email failed:', e.message); }
  if (!emailOk && smsTo && smsBody) {
    try {
      const twilio = require('twilio');
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: smsBody, from: process.env.TWILIO_PHONE_NUMBER, to: smsTo,
        });
        smsOk = true;
        console.log('[Critical] email failed, SMS fallback sent to', smsTo);
      } else {
        console.warn('[Critical] email failed and Twilio not configured — message NOT delivered to', to);
      }
    } catch (e) { console.error('[Critical] SMS fallback failed:', e.message); }
  }
  return { email: emailOk, sms: smsOk };
};

// ── Email wrapper ─────────────────────────────────────────────
const wrap = (body) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 20px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="margin: 0; color: #1a5276;">${AGENCY_NAME}</h2>
    </div>
    ${body}
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
    <p style="color: #999; font-size: 0.75rem; text-align: center;">
      This is an automated message from ${AGENCY_NAME}. Please do not reply directly to this email.
      <br/>HIPAA Notice: This email may contain protected health information (PHI).
    </p>
  </div>
`;

// ── Client Portal Invite ──────────────────────────────────────
// throwOnError so the admin UI can surface the real SendGrid reason
// (sender not verified, etc.) instead of a silent failure.
const sendClientPortalInvite = async ({ to, clientName, inviteUrl }) => {
  return sendEmail({
    to,
    subject: `You're invited to the ${AGENCY_NAME} Client Portal`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${clientName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        You've been invited to access your personal care portal. From the portal, you can:
      </p>
      <ul style="color: #555; font-size: 0.95rem; padding-left: 20px;">
        <li>View your upcoming visit schedule</li>
        <li>See your assigned caregivers</li>
        <li>Review invoices and billing</li>
        <li>Receive important notifications</li>
      </ul>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${inviteUrl}" style="background: #1a5276; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; display: inline-block;">
          Set Up Your Account
        </a>
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        This link expires in 48 hours. If it has expired, please contact your care coordinator for a new invite.
      </p>
    `),
  }, { throwOnError: true });
};

// ── Client Portal Password Reset ──────────────────────────────
// Reuses the invite-token + /portal/setup flow, so the link works exactly
// like an invite but with reset wording.
const sendClientPortalPasswordReset = async ({ to, clientName, resetUrl }) => {
  return sendEmail({
    to,
    subject: `Reset your ${AGENCY_NAME} Client Portal password`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${clientName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        We received a request to reset your Client Portal password. Click the
        button below to choose a new password:
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="background: #1a5276; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; display: inline-block;">
          Reset My Password
        </a>
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        This link expires in 1 hour. If you didn't request a password reset,
        you can safely ignore this email — your current password still works.
      </p>
    `),
  }, { throwOnError: true });
};

// ── Family Portal Welcome ─────────────────────────────────────
const sendFamilyPortalWelcome = async ({ to, familyName, clientName, tempPassword }) => {
  const loginUrl = `${FRONTEND_URL}/family`;

  return sendEmail({
    to,
    subject: `Your ${AGENCY_NAME} Family Portal Account`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${familyName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        A family portal account has been created for you to stay connected with
        <strong>${clientName}</strong>'s care. Depending on your permissions, you can:
      </p>
      <ul style="color: #555; font-size: 0.95rem; padding-left: 20px;">
        <li>View the care schedule</li>
        <li>Review the care plan and visit notes</li>
        <li>See current medications</li>
        <li>Message the care team</li>
      </ul>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <p style="margin: 0 0 8px; color: #333; font-weight: 600; font-size: 0.9rem;">Your login credentials:</p>
        <p style="margin: 0; color: #555; font-size: 0.9rem;">
          Email: <strong>${to}</strong><br/>
          Temporary Password: <strong>${tempPassword}</strong>
        </p>
      </div>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${loginUrl}" style="background: #2d5016; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; display: inline-block;">
          Sign In to Family Portal
        </a>
      </div>
      <p style="color: #e74c3c; font-size: 0.85rem; font-weight: 600;">
        For security, please change your password after your first login.
      </p>
    `),
  });
};

// ── Family Portal Password Reset ──────────────────────────────
const sendFamilyPasswordReset = async ({ to, familyName, newPassword }) => {
  const loginUrl = `${FRONTEND_URL}/family`;

  return sendEmail({
    to,
    subject: `${AGENCY_NAME} Family Portal — Password Reset`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${familyName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        Your family portal password has been reset by an administrator.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <p style="margin: 0 0 8px; color: #333; font-weight: 600; font-size: 0.9rem;">Your new credentials:</p>
        <p style="margin: 0; color: #555; font-size: 0.9rem;">
          Email: <strong>${to}</strong><br/>
          New Password: <strong>${newPassword}</strong>
        </p>
      </div>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${loginUrl}" style="background: #2d5016; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; display: inline-block;">
          Sign In
        </a>
      </div>
    `),
  });
};

// ── Staff Password Reset ─────────────────────────────────────
const sendPasswordReset = async ({ to, userName, resetUrl }) => {
  return sendEmail({
    to,
    subject: `${AGENCY_NAME} — Password Reset Request`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${userName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        We received a request to reset your password. Click the button below to set a new password.
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="background: #1a5276; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 1rem; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #888; font-size: 0.85rem;">
        This link expires in 1 hour. If you didn't request this reset, you can safely ignore this email.
      </p>
    `),
  });
};

// ── Invoice Email with Pay Now Button ────────────────────────
const sendInvoiceEmail = async ({ to, clientName, invoiceNumber, invoiceId, total, amountDue, billingPeriodStart, billingPeriodEnd, dueDate, lineItems }) => {
  const payUrl = `${FRONTEND_URL}/pay/${invoiceId}`;
  const periodStart = new Date(billingPeriodStart).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const periodEnd   = new Date(billingPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dueDateStr  = new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const totalStr    = Number(parseFloat(total)).toFixed(2);
  const dueStr      = Number(parseFloat(amountDue)).toFixed(2);

  // Build line items table rows
  let lineItemRows = '';
  if (lineItems && lineItems.length > 0) {
    lineItemRows = lineItems.slice(0, 20).map(item => {
      const svcDate = item.service_date ? new Date(item.service_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const hrs = parseFloat(item.hours || 0).toFixed(1);
      const amt = Number(parseFloat(item.amount || 0)).toFixed(2);
      const desc = item.description || 'Home Care Services';
      return `<tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #555;">${svcDate}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #555;">${desc}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #555; text-align: right;">${hrs}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #555; text-align: right;">$${amt}</td>
      </tr>`;
    }).join('');
    if (lineItems.length > 20) {
      lineItemRows += `<tr><td colspan="4" style="padding: 6px 8px; font-size: 0.8rem; color: #999; text-align: center;">...and ${lineItems.length - 20} more items</td></tr>`;
    }
  }

  const lineItemsTable = lineItemRows ? `
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <thead>
        <tr style="background: #f8f9fa;">
          <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #666; border-bottom: 2px solid #ddd;">Date</th>
          <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #666; border-bottom: 2px solid #ddd;">Description</th>
          <th style="padding: 8px; text-align: right; font-size: 0.8rem; color: #666; border-bottom: 2px solid #ddd;">Hours</th>
          <th style="padding: 8px; text-align: right; font-size: 0.8rem; color: #666; border-bottom: 2px solid #ddd;">Amount</th>
        </tr>
      </thead>
      <tbody>${lineItemRows}</tbody>
    </table>
  ` : '';

  return sendEmail({
    to,
    subject: `Invoice #${invoiceNumber} from ${AGENCY_NAME} — $${dueStr} Due`,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${clientName},</p>
      <p style="color: #555; font-size: 0.95rem;">
        Please find your invoice details below for home care services provided during
        <strong>${periodStart} — ${periodEnd}</strong>.
      </p>

      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #666; font-size: 0.9rem;">Invoice Number:</td>
            <td style="padding: 4px 0; color: #333; font-weight: 600; text-align: right; font-size: 0.9rem;">#${invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666; font-size: 0.9rem;">Invoice Total:</td>
            <td style="padding: 4px 0; color: #333; font-weight: 600; text-align: right; font-size: 0.9rem;">$${totalStr}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666; font-size: 0.9rem;">Amount Due:</td>
            <td style="padding: 4px 0; color: #1a5276; font-weight: 700; text-align: right; font-size: 1.1rem;">$${dueStr}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666; font-size: 0.9rem;">Due Date:</td>
            <td style="padding: 4px 0; color: #333; font-weight: 600; text-align: right; font-size: 0.9rem;">${dueDateStr}</td>
          </tr>
        </table>
      </div>

      ${lineItemsTable}

      <div style="text-align: center; margin: 28px 0;">
        <a href="${payUrl}" style="background: #27ae60; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1.1rem; display: inline-block;">
          Pay Now — $${dueStr}
        </a>
      </div>

      <p style="color: #888; font-size: 0.85rem; text-align: center;">
        Click the button above to make a secure payment via credit or debit card.
      </p>

      <p style="color: #555; font-size: 0.9rem; margin-top: 24px;">
        If you have questions about this invoice, please contact us at
        <strong>support@chippewavalleyhomecare.com</strong> or call our office.
      </p>
    `),
  }, { throwOnError: true });
};

// ── Invoice Payment Reminder ─────────────────────────────────
// For nudging unpaid invoices. Same Pay Now button as the first send, but the
// subject and copy make it clear this is a reminder. daysOverdue is positive
// when past due, negative when still in the upcoming-due window.
const sendInvoiceReminder = async ({ to, clientName, invoiceNumber, invoiceId, amountDue, dueDate, daysOverdue }) => {
  const payUrl = `${FRONTEND_URL}/pay/${invoiceId}`;
  const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dueStr = Number(parseFloat(amountDue)).toFixed(2);

  const overdueDays = Math.round(daysOverdue || 0);
  const isOverdue = overdueDays > 0;
  const headline = isOverdue
    ? `Your payment is ${overdueDays} day${overdueDays === 1 ? '' : 's'} past due`
    : `Friendly reminder: your invoice is due soon`;
  const subject = isOverdue
    ? `Payment Reminder — Invoice #${invoiceNumber} ($${dueStr} past due)`
    : `Payment Reminder — Invoice #${invoiceNumber} ($${dueStr} due ${dueDateStr})`;
  const bannerColor = isOverdue ? '#B91C1C' : '#B45309';

  return sendEmail({
    to,
    subject,
    html: wrap(`
      <p style="color: #333; font-size: 1rem;">Hello ${clientName},</p>

      <div style="background: #FEF2F2; border-left: 4px solid ${bannerColor}; padding: 14px 18px; margin: 16px 0; border-radius: 6px;">
        <p style="margin: 0; color: ${bannerColor}; font-weight: 700; font-size: 1rem;">${headline}</p>
      </div>

      <p style="color: #555; font-size: 0.95rem;">
        This is a reminder that invoice <strong>#${invoiceNumber}</strong> for
        <strong>$${dueStr}</strong> is ${isOverdue ? 'past due' : `due on ${dueDateStr}`}.
      </p>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${payUrl}" style="background: #27ae60; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1.1rem; display: inline-block;">
          Pay Now — $${dueStr}
        </a>
      </div>

      <p style="color: #555; font-size: 0.9rem; margin-top: 24px;">
        If you've already paid, thank you — please disregard this notice. Otherwise,
        contact us at <strong>support@chippewavalleyhomecare.com</strong> or call our
        office if you have any questions or need to set up a payment plan.
      </p>
    `),
  }, { throwOnError: true });
};

// ── Caregiver Welcome ─────────────────────────────────────────
const sendCaregiverWelcome = async ({ to, firstName, tempPassword }) => {
  const loginUrl = 'https://app.chippewavalleyhomecare.com';

  return sendEmail({
    to,
    subject: `Welcome to ${AGENCY_NAME}!`,
    html: wrap(`
      <h3 style="color: #059669;">Welcome aboard, ${firstName}!</h3>
      <p>You've been hired as a caregiver at ${AGENCY_NAME}. Your account is ready to go.</p>

      <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px; font-weight: 700; color: #065F46;">Your Login Credentials</p>
        <p style="margin: 4px 0;"><strong>Email:</strong> ${to}</p>
        <p style="margin: 4px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
      </div>

      <p style="text-align: center; margin: 24px 0;">
        <a href="${loginUrl}" style="background: #059669; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
          Log In to the App
        </a>
      </p>

      <p style="color: #555; font-size: 0.9rem;">
        Use the link above or go to <strong>${loginUrl}</strong> on your phone or computer.
        We recommend changing your password after your first login.
      </p>

      <p style="color: #555; font-size: 0.9rem;">
        If you have any questions, please contact the office. We're glad to have you on the team!
      </p>
    `),
  });
};

// ── Onboarding Packet Invite (post-hire) ──────────────────────────────
// Emailed immediately after /hire. Deep-links into the tokenized onboarding
// packet page where the caregiver signs BGC consent and completes deeper info.
const sendOnboardingPacketInvite = async ({ to, firstName, packetUrl, expiresAt }) => {
  const expiresStr = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '14 days from now';

  return sendEmail({
    to,
    subject: `Welcome to ${AGENCY_NAME} — complete your onboarding`,
    html: wrap(`
      <h3 style="color: #059669;">Welcome aboard, ${firstName}!</h3>
      <p>We're excited to have you join the ${AGENCY_NAME} team. Before your first shift,
         we need a little more information from you and your consent to run the Wisconsin
         caregiver background check.</p>

      <p>This should take about 10–15 minutes and can be done from your phone or computer.
         Please complete it as soon as you can — we can't schedule you for shifts until
         this is done.</p>

      <div style="text-align: center; margin: 28px 0;">
        <a href="${packetUrl}" style="background: #059669; color: #fff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1.05rem; display: inline-block;">
          Complete Your Onboarding
        </a>
      </div>

      <p style="color: #888; font-size: 0.85rem;">
        This link expires on <strong>${expiresStr}</strong>. If it expires before you
        finish, contact the office and we'll send you a new one.
      </p>

      <p style="color: #555; font-size: 0.9rem; margin-top: 24px;">
        You'll still receive a separate email with login credentials for the caregiver app.
        Please complete this onboarding packet first so we can finish setting up your account.
      </p>
    `),
  });
};

// ── Background Check Status (admin notification) ──────────────────────
const sendAdminBgcResult = async ({ to, caregiverName, status, summary, matches }) => {
  const matchList = (matches || []).length === 0
    ? '<p style="color:#065F46;">No statutory matches detected.</p>'
    : '<ul style="color:#374151; padding-left:18px;">' +
      (matches || []).map(m => `<li><strong>${m.statute}</strong> — ${m.short_title} (${m.severity})</li>`).join('') +
      '</ul>';

  const statusColor = status === 'clear' ? '#059669'
                    : status === 'disqualified' ? '#B91C1C'
                    : '#B45309';
  const statusLabel = status === 'clear'          ? 'Cleared'
                    : status === 'disqualified'   ? 'Disqualified'
                    : status === 'rehab_review'   ? 'Rehabilitation Review Required'
                    : 'Flagged for Review';

  return sendEmail({
    to,
    subject: `Background check result for ${caregiverName}: ${statusLabel}`,
    html: wrap(`
      <p style="color: #333;">Background check processing complete for <strong>${caregiverName}</strong>.</p>

      <div style="background: #F9FAFB; border-left: 4px solid ${statusColor}; padding: 12px 16px; margin: 16px 0; border-radius: 6px;">
        <div style="font-weight: 700; color: ${statusColor}; font-size: 1rem;">${statusLabel}</div>
        <div style="color: #374151; margin-top: 6px;">${summary}</div>
      </div>

      <p style="color: #6B7280; font-size: 0.9rem; margin-top: 20px;">Matched statutes:</p>
      ${matchList}

      <p style="color: #555; font-size: 0.9rem; margin-top: 16px;">
        Log in to the CRM to review the full WORCS report and make a hiring decision.
      </p>
    `),
  });
};

module.exports = {
  sendEmail,
  sendCriticalNotification,
  sendClientPortalInvite,
  sendClientPortalPasswordReset,
  sendFamilyPortalWelcome,
  sendFamilyPasswordReset,
  sendPasswordReset,
  sendInvoiceEmail,
  sendInvoiceReminder,
  sendCaregiverWelcome,
  sendOnboardingPacketInvite,
  sendAdminBgcResult,
  isConfigured,
};
