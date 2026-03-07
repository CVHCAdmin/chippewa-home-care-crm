// services/emailService.js
// SendGrid email service for portal invites and notifications
const sgMail = require('@sendgrid/mail');

const SENDGRID_API_KEY  = process.env.SENDGRID_API_KEY;
const FROM_EMAIL        = process.env.SENDGRID_FROM_EMAIL || 'noreply@chippewahomecare.com';
const AGENCY_NAME       = process.env.AGENCY_NAME || 'Chippewa Valley Home Care';
const FRONTEND_URL      = process.env.FRONTEND_URL || 'https://cvhc-crm.netlify.app';

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

module.exports = {
  sendEmail,
  sendClientPortalInvite,
  sendFamilyPortalWelcome,
  sendFamilyPasswordReset,
  isConfigured,
};
