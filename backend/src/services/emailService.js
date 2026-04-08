// services/emailService.js
// SendGrid email service for portal invites and notifications
const sgMail = require('@sendgrid/mail');

const SENDGRID_API_KEY  = process.env.SENDGRID_API_KEY;
const FROM_EMAIL        = process.env.SENDGRID_FROM_EMAIL || 'noreply@chippewahomecare.com';
const AGENCY_NAME       = process.env.AGENCY_NAME || 'Chippewa Valley Home Care';
const FRONTEND_URL      = process.env.FRONTEND_URL || 'https://app.chippewavalleyhomecare.com';

const isConfigured = SENDGRID_API_KEY && SENDGRID_API_KEY !== 'optional';

if (isConfigured) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ── Helper ────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html }) => {
  if (!isConfigured) {
    console.warn('[Email] SendGrid not configured — skipping email to', to);
    return false;
  }

  try {
    await sgMail.send({ to, from: { email: FROM_EMAIL, name: AGENCY_NAME }, subject, html });
    console.log('[Email] Sent to', to, '—', subject);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send to', to, ':', error?.response?.body?.errors || error.message);
    return false;
  }
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
  });
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
  });
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

module.exports = {
  sendEmail,
  sendClientPortalInvite,
  sendFamilyPortalWelcome,
  sendFamilyPasswordReset,
  sendPasswordReset,
  sendInvoiceEmail,
  sendCaregiverWelcome,
  isConfigured,
};
