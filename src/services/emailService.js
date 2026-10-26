/**
 * emailService.js — the transactional e-mails, sent through Resend: the login link, a participant removed by an
 * administrator, and a promotion from the waiting list.
 *
 * What keeps them out of spam folders: a From address on the site's own (verified) domain with a display name,
 * Reply-To set to the contact address, a plain-text part next to the HTML, no images or tracking pixels, and
 * transactional headers (plus List-Unsubscribe on the login link).
 *
 * Each send function resolves with Resend's response and throws when Resend rejects the message.
 */

const { Resend } = require('resend');
const { contactEmail } = require('../utils/contact');
const { appUrl } = require('../utils/appUrl');
const { SiteSettingsModel } = require('../models/database');

let resend;

function getResend() {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('Brak RESEND_API_KEY w zmiennych środowiskowych');
    resend = new Resend(apiKey);
  }
  return resend;
}

/**
 * Outside production and without RESEND_API_KEY, messages are printed to the console instead of being sent, so the
 * app can be tried locally: the login link appears in the terminal. In production a missing key stays an error.
 */
function sendsToConsole(env = process.env) {
  return !env.RESEND_API_KEY && env.NODE_ENV !== 'production';
}

const consoleMailer = {
  emails: {
    async send(message) {
      console.log(`\n✉️  [RESEND_API_KEY not set: printed, not sent] To: ${message.to.join(', ')}\n` +
        `    Subject: ${message.subject}\n\n${message.text}\n`);
      return { data: { id: 'console' }, error: null };
    }
  }
};

/**
 * The operator's funding note from the site settings ('' when not set). Read when a message is built, so a change in
 * the admin panel applies to the next e-mail; a database that is not open yet simply means no note.
 */
function fundingNote() {
  try {
    return (SiteSettingsModel.all().funding_note || '').trim();
  } catch {
    return '';
  }
}

/**
 * Makes a value safe as HTML text or as a quoted attribute value. Every value interpolated into the HTML e-mails goes
 * through it: names and class names are typed by people.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The funding note as a footer paragraph of the HTML e-mails, or nothing. */
function fundingNoteHtml() {
  const note = fundingNote();
  return note ? `<p style="margin:0;font-size:11px;color:#999999;">${escapeHtml(note)}</p>` : '';
}

/** A footer row with the funding note, or nothing (no empty grey bar when there is no note). */
function fundingNoteRow() {
  const note = fundingNoteHtml();
  return note
    ? `<tr><td style="background:#f8f9f5;border-top:1px solid #e8ece0;padding:16px 48px;text-align:center;">${note}</td></tr>`
    : '';
}

/** The funding note as the last line of the plain-text e-mails, or nothing. */
function fundingNoteText() {
  const note = fundingNote();
  return note ? `\n${note}` : '';
}

function getMailer() {
  return sendsToConsole() ? consoleMailer : getResend();
}

// Without EMAIL_FROM the sender is noreply@ on the host the site is served from (APP_URL). Resend only sends from a
// domain that has been verified, so set EMAIL_FROM explicitly when the mail domain differs from the site's.
const FROM_ADDRESS  = process.env.EMAIL_FROM  || `Fantastyczne Wspinanie <noreply@${new URL(appUrl()).hostname}>`;
const CONTACT_EMAIL = contactEmail();
const REPLY_TO      = process.env.EMAIL_REPLY || CONTACT_EMAIL;
const APP_NAME      = 'Fantastyczne Wspinanie — System zapisów';

function magicLinkEmailHTML(rawMagicLink, isNewUser) {
  const magicLink = escapeHtml(rawMagicLink);
  const heading = isNewUser
    ? 'Aktywuj konto &#x1F44B;'
    : 'Twój link do logowania';

  const body = isNewUser
    ? 'Twoje konto zostało założone. Kliknij poniżej, aby je aktywować i uzupełnić profil.'
    : 'Kliknij poniższy przycisk, aby zalogować się do systemu. Link jest <strong>jednorazowy</strong> i ważny przez <strong>15 minut</strong>.';

  return `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f4eb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!--[if mso]><table role="presentation" width="100%"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f4eb;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5d0;">

        <!-- Header -->
        <tr>
          <td style="background-color:#1a3a2a;padding:36px 48px;text-align:center;">
            <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.3px;">Fantastyczne Wspinanie</h1>
            <p style="margin:4px 0 0;font-size:11px;color:#6b8f72;letter-spacing:1px;">System zapisów na zajęcia</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:44px 48px 32px;">
            <h2 style="margin:0 0 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#111111;">${heading}</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#555555;">${body}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 36px;">
              <tr>
                <td style="border-radius:8px;background-color:#2d5a3d;">
                  <a href="${magicLink}" target="_blank" rel="noopener noreferrer"
                     style="display:block;padding:15px 44px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                    ${isNewUser ? 'Aktywuj konto' : 'Zaloguj się'} &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f8f9f5;border:1px solid #e4e9da;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888888;">Link nie działa? Skopiuj adres:</p>
                  <p style="margin:0;font-size:12px;color:#2d5a3d;word-break:break-all;">${magicLink}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9f5;border-top:1px solid #e8ece0;padding:20px 48px;text-align:center;">
            <p style="margin:0 0 6px;font-size:11px;color:#aaaaaa;">
              Nie prosiłeś(-aś) o ten link? Możesz go zignorować — żadne działanie nie jest wymagane.
            </p>
            ${fundingNoteHtml()}
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

function magicLinkEmailText(magicLink, isNewUser) {
  return isNewUser
    ? `Witaj!\n\nKliknij ten link, aby aktywować konto (ważny 15 min):\n${magicLink}\n\nJeśli nie zakładałeś(-aś) konta — zignoruj tę wiadomość.\n\n-- Fantastyczne Wspinanie | ${CONTACT_EMAIL}${fundingNoteText()}`
    : `Twój link do logowania (jednorazowy, ważny 15 min):\n${magicLink}\n\nJeśli nie prosiłeś(-aś) o ten link — zignoruj tę wiadomość.\n\n-- Fantastyczne Wspinanie | ${CONTACT_EMAIL}${fundingNoteText()}`;
}

async function sendMagicLink(email, magicLink, isNewUser = false) {
  const client = getMailer();
  const subject = isNewUser
    ? `Aktywuj swoje konto — ${APP_NAME}`
    : `Twój link do logowania — ${APP_NAME}`;

  const { data, error } = await client.emails.send({
    from:     FROM_ADDRESS,
    to:       [email],
    reply_to: REPLY_TO,
    subject,
    html: magicLinkEmailHTML(magicLink, isNewUser),
    text: magicLinkEmailText(magicLink, isNewUser),
    headers: {
      // Marks the message as transactional, not bulk or marketing mail.
      'X-Entity-Ref-ID':  `magic-link-${Date.now()}`,
      'Precedence':       'transactional',
      'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=Unsubscribe>`
    }
  });

  if (error) {
    console.error('Resend error (magic link):', error);
    throw new Error(error.message);
  }
  console.log(`✉️  Magic link -> ${email} (id: ${data?.id})`);
  return data;
}

async function initEmailService() {
  if (sendsToConsole()) {
    console.warn('⚠️  RESEND_API_KEY is not set: e-mails are printed to the console (development only).');
    return;
  }
  try { getResend(); console.log('✅ Resend email service gotowy'); }
  catch (err) { console.warn('⚠️  Resend:', err.message); }
}

function participantRemovedHTML(rawParticipantName, rawClassName, rawClassDate) {
  const [participantName, className, classDate] = [rawParticipantName, rawClassName, rawClassDate].map(escapeHtml);
  const contact = escapeHtml(CONTACT_EMAIL);
  return `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wypisanie z zajęć</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f4eb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f4eb;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5d0;">
        <tr>
          <td style="background-color:#1a3a2a;padding:28px 48px;text-align:center;">
            <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:900;color:#ffffff;">Fantastyczne Wspinanie</h1>
            <p style="margin:4px 0 0;font-size:11px;color:#6b8f72;letter-spacing:1px;">System zapisów na zajęcia</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 48px 32px;">
            <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111;">Wypisanie z zajęć</h2>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#555;">
              Informujemy, że uczestnik <strong>${participantName}</strong> został wypisany z zajęć:
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#f8f9f5;border:1px solid #e4e9da;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;">Zajęcia</p>
                  <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111;">${className}</p>
                  <p style="margin:0;font-size:14px;color:#555;">📅 ${classDate}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#777;">
              Decyzja została podjęta przez administratora. W razie pytań skontaktuj się z nami pod adresem
              <a href="mailto:${contact}" style="color:#2d5a3d;font-weight:600;">${contact}</a>.
            </p>
          </td>
        </tr>
        ${fundingNoteRow()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function participantRemovedText(participantName, className, classDate) {
  return `Wypisanie z zajęć\n\nUczestnik ${participantName} został wypisany z zajęć "${className}" (${classDate}).\n\nDecyzja została podjęta przez administratora.\nW razie pytań: ${CONTACT_EMAIL}\n\n-- Fantastyczne Wspinanie${fundingNoteText()}`;
}

async function sendParticipantRemovedEmail(toEmail, participantName, className, classDate) {
  const client = getMailer();
  const { data, error } = await client.emails.send({
    from:     FROM_ADDRESS,
    to:       [toEmail],
    reply_to: REPLY_TO,
    subject:  `Wypisanie z zajęć: ${participantName} — ${APP_NAME}`,
    html: participantRemovedHTML(participantName, className, classDate),
    text: participantRemovedText(participantName, className, classDate),
    headers: {
      'X-Entity-Ref-ID': `participant-removed-${Date.now()}`,
      'Precedence':      'transactional'
    }
  });

  if (error) {
    console.error('Resend error (participant removed):', error);
    throw new Error(error.message);
  }
  console.log(`✉️  Participant removed notification -> ${toEmail} (id: ${data?.id})`);
  return data;
}

function waitingListPromotedHTML(rawFirstName, rawClassName, rawClassDate, rawDashboardLink) {
  const [firstName, className, classDate, dashboardLink] =
    [rawFirstName, rawClassName, rawClassDate, rawDashboardLink].map(escapeHtml);
  const contact = escapeHtml(CONTACT_EMAIL);
  return `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Miejsce zwolniło się!</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f4eb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f4eb;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dde5d0;">
        <tr>
          <td style="background-color:#1a3a2a;padding:28px 48px;text-align:center;">
            <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:900;color:#ffffff;">Fantastyczne Wspinanie</h1>
            <p style="margin:4px 0 0;font-size:11px;color:#6b8f72;letter-spacing:1px;">System zapisów na zajęcia</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 48px 32px;">
            <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111;">&#x1F389; Miejsce zwolniło się!</h2>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#555;">
              Cześć <strong>${firstName}</strong>!<br><br>
              Świetna wiadomość — zwolniło się dla Ciebie miejsce i Twój zapis z listy rezerwowej został <strong>automatycznie potwierdzony</strong>.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td style="background:#f8f9f5;border:1px solid #e4e9da;border-radius:8px;padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;">Zajęcia</p>
                  <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111;">${className}</p>
                  <p style="margin:0;font-size:14px;color:#555;">&#x1F4C5; ${classDate}</p>
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="border-radius:8px;background-color:#2d5a3d;">
                  <a href="${dashboardLink}" target="_blank" rel="noopener noreferrer"
                     style="display:block;padding:14px 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">
                    Przejdź do panelu &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#777;">
              W razie pytań skontaktuj się z nami: <a href="mailto:${contact}" style="color:#2d5a3d;font-weight:600;">${contact}</a>
            </p>
          </td>
        </tr>
        ${fundingNoteRow()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function waitingListPromotedText(firstName, className, classDate) {
  return `Cześć ${firstName}!\n\nMiejsce zwolniło się i Twój zapis z listy rezerwowej został automatycznie potwierdzony.\n\nZajęcia: "${className}"\nData: ${classDate}\n\nZaloguj się do panelu uczestnika, aby zobaczyć szczegóły.\n\nW razie pytań: ${CONTACT_EMAIL}\n\n-- Fantastyczne Wspinanie${fundingNoteText()}`;
}

async function sendWaitingListPromotedEmail(toEmail, firstName, className, classDate, dashboardLink) {
  const client = getMailer();
  const { data, error } = await client.emails.send({
    from:     FROM_ADDRESS,
    to:       [toEmail],
    reply_to: REPLY_TO,
    subject:  `Miejsce zwolniło się! Twój zapis potwierdzony — ${APP_NAME}`,
    html: waitingListPromotedHTML(firstName, className, classDate, dashboardLink),
    text: waitingListPromotedText(firstName, className, classDate),
    headers: {
      'X-Entity-Ref-ID': `waitlist-promoted-${Date.now()}`,
      'Precedence':      'transactional'
    }
  });

  if (error) {
    console.error('Resend error (waitlist promoted):', error);
    throw new Error(error.message);
  }
  console.log(`✉️  Waitlist promoted -> ${toEmail} (id: ${data?.id})`);
  return data;
}

module.exports = { initEmailService, sendMagicLink, sendParticipantRemovedEmail, sendWaitingListPromotedEmail };
