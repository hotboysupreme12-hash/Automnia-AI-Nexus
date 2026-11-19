import crypto from 'node:crypto';

function encodeMimeHeader(value) {
  const text = String(value || '').replace(/[\r\n]/g, ' ');
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

export function buildLicenseEmailMimeMessage({ from, to, subject, text, html }) {
  const boundary = `automnia-${crypto.randomBytes(12).toString('hex')}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function encodeGmailRawMessage(mimeMessage) {
  return Buffer.from(mimeMessage, 'utf8').toString('base64url');
}

export function encodeMicrosoftGraphRawMessage(mimeMessage) {
  return Buffer.from(mimeMessage, 'utf8').toString('base64');
}
