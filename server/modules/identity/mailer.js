'use strict';

function messagePresentation(message) {
  const webOrigin = process.env.WEB_APP_ORIGIN || 'http://127.0.0.1:3000';
  if (message.purpose === 'password_reset') return { link: `${webOrigin}/auth?reset=${encodeURIComponent(message.token)}`, subject: 'Reset your CodeWithMee password', actionText: 'Reset Password', description: 'We received a request to reset your password.' };
  if (message.purpose === 'course_invitation') return { link: `${webOrigin}/courses?invite=${encodeURIComponent(message.token)}`, subject: 'You are invited to a CodeWithMee course', actionText: 'Accept Course Invitation', description: 'A verified course provider invited you to join a course.' };
  if (message.purpose === 'organization_invitation') return { link: `${webOrigin}/provider?invite=${encodeURIComponent(message.token)}`, subject: 'You are invited to a CodeWithMee organization', actionText: 'Accept Organization Invitation', description: 'A provider invited you to join their organization.' };
  return { link: `${webOrigin}/auth?verify=${encodeURIComponent(message.token)}`, subject: 'Verify your CodeWithMee email', actionText: 'Verify Email', description: 'Thanks for signing up. Please verify your email address.' };
}

function createDisabledIdentityMailer({ logger = console } = {}) {
  return Object.freeze({
    async send(message) {
      if (process.env.NODE_ENV !== 'production') {
        const { link } = messagePresentation(message);
        console.log(`\n📧 [DEV MAILER] Password/Email action for ${message.to}:`);
        console.log(`🔗 Link: ${link}\n`);
      }
      logger.warn('identity_delivery_unavailable', { purpose: message.purpose });
      return Object.freeze({ delivered: false, providerMessageId: null });
    },
  });
}

function createCaptureIdentityMailer() {
  const messages = [];
  return Object.freeze({
    async send(message) {
      const captured = structuredClone(message);
      messages.push(captured);
      return Object.freeze({
        delivered: true,
        providerMessageId: `capture-${messages.length}`,
      });
    },
    messages,
  });
}

const axios = require('axios');
const dns = require('dns');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore if unsupported in environment
}

function createResendIdentityMailer({ apiKey, from = 'CodeWithMee <onboarding@resend.dev>', logger = console }) {
  return Object.freeze({
    async send(message) {
      const { actionText, description, link, subject } = messagePresentation(message);

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d0e12; color: #ffffff; padding: 40px 20px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1);">
          <h1 style="color: #ffffff; font-size: 24px; margin-bottom: 16px; text-align: center;">CodeWithMee</h1>
          <p style="color: #cccccc; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            ${description}
          </p>
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="${link}" style="background-color: #4285F4; color: #ffffff; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 9999px; display: inline-block; font-size: 15px;">
              ${actionText}
            </a>
          </div>
          <p style="color: #888888; font-size: 13px; text-align: center; margin: 0;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      `;

      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n📧 [RESEND EMAIL QUEUED] Sending to: ${message.to}`);
        console.log(`🔗 Action Link: ${link}\n`);
      }

      try {
        const response = await axios.post(
          'https://api.resend.com/emails',
          {
            from,
            to: [message.to],
            subject,
            html,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        console.log(`✅ [RESEND DELIVERED] Email sent to ${message.to}. ID: ${response.data?.id}`);
        logger.info?.('identity_resend_delivered', { id: response.data?.id, to: message.to });

        return Object.freeze({
          delivered: true,
          providerMessageId: response.data?.id || 'resend-sent',
        });
      } catch (error) {
        const detail = error.response?.data || error.message;
        console.error('❌ [RESEND ERROR]:', detail);
        logger.warn?.('identity_resend_failed', { error: detail, to: message.to });
        return Object.freeze({ delivered: false, providerMessageId: null });
      }
    },
  });
}

const nodemailer = require('nodemailer');

function createSmtpIdentityMailer({ host, port, user, pass, from, logger = console }) {
  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: Number(port) || 587,
    secure: Number(port) === 465,
    auth: { user, pass },
  });

  return Object.freeze({
    async send(message) {
      const { actionText, description, link, subject } = messagePresentation(message);

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d0e12; color: #ffffff; padding: 40px 20px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.1);">
          <h1 style="color: #ffffff; font-size: 24px; margin-bottom: 16px; text-align: center;">CodeWithMee</h1>
          <p style="color: #cccccc; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            ${description}
          </p>
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="${link}" style="background-color: #4285F4; color: #ffffff; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 9999px; display: inline-block; font-size: 15px;">
              ${actionText}
            </a>
          </div>
          <p style="color: #888888; font-size: 13px; text-align: center; margin: 0;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      `;

      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n📧 [GMAIL SMTP QUEUED] Sending to: ${message.to}`);
        console.log(`🔗 Action Link: ${link}\n`);
      }

      try {
        const info = await transporter.sendMail({
          from: from || `CodeWithMee <${user}>`,
          to: message.to,
          subject,
          html,
        });

        console.log(`✅ [GMAIL SMTP DELIVERED] Email sent to ${message.to}. ID: ${info.messageId}`);
        logger.info?.('identity_smtp_delivered', { id: info.messageId, to: message.to });

        return Object.freeze({
          delivered: true,
          providerMessageId: info.messageId || 'smtp-sent',
        });
      } catch (error) {
        console.error('❌ [GMAIL SMTP ERROR]:', error.message);
        logger.warn?.('identity_smtp_failed', { error: error.message, to: message.to });
        return Object.freeze({ delivered: false, providerMessageId: null });
      }
    },
  });
}

module.exports = {
  createCaptureIdentityMailer,
  createDisabledIdentityMailer,
  createResendIdentityMailer,
  createSmtpIdentityMailer,
};
