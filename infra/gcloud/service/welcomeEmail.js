function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
// AUTMNIA AI NEXUS email lockup is the same brand asset served by the Shopify
// storefront and used in the app UI. Keeping it on the public storefront gives
// email clients a stable, cacheable image URL instead of relying on an inline
// SVG or a local asset.
const automniaLogoUrl = 'https://automnia.app/cdn/shop/t/3/assets/automnia-ai-nexus-logo.png';
const automniaAppUrl = 'https://automnia.app';

const brand = Object.freeze({
  ink: '#030913',
  canvas: '#07111E',
  // Sampled from the supplied Automnia lockup: bright hyper-teal on the
  // exact #07111E app surface. Use one accent family so the email matches
  // the logo instead of introducing a separate blue.
  cyan: '#2EFCE6',
  blue: '#2EFCE6',
  text: '#DCE8F5',
  muted: '#A7B5C8',
  lightCanvas: '#F5F9FD',
  lightPanel: '#FFFFFF',
  lightText: '#132238',
  lightMuted: '#52657C',
});

function accessDescription(record) {
  if (record?.mode === 'byok') return 'BYOK access is active. You can connect your own provider from Automnia Settings.';
  if (record?.permanentAccess) return 'Permanent Automnia access is active for this account.';
  return 'Automnia Cloud credits are available for this account.';
}

function onboardingInstructions(record) {
  const instructions = Array.isArray(record?.onboarding?.instructions) ? record.onboarding.instructions : [];
  return instructions.length
    ? instructions
    : [
      'Open the Automnia AI Nexus app.',
      'Choose Link a purchase or Account & License.',
      'Enter the purchase email and license key from this message.',
      'Finish by signing in with your password or Google account.',
    ];
}

export function buildLicenseEmailHtml(record) {
  const name = escapeHtml(record?.onboarding?.customerName || 'there');
  const email = escapeHtml(record?.email || '');
  const licenseKey = escapeHtml(record?.licenseKey || '');
  const tier = escapeHtml(record?.tier || 'Automnia access');
  const access = escapeHtml(accessDescription(record));
  const downloadAccessUrl = String(record?.downloadAccessUrl || '').trim();
  const greeting = name === 'there' ? 'Welcome to Automnia.' : `Welcome, ${name}.`;
  const downloadSection = downloadAccessUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;border:1px solid #B9D8F1;border-radius:14px;background:#EEF7FF;"><tr><td style="padding:22px 22px 20px;"><div style="margin:0 0 8px;color:${brand.blue};font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">Your secure download</div><p style="margin:0 0 16px;color:${brand.lightMuted};font-size:14px;line-height:1.6;">Use this private page whenever you need an installer. It checks your active access and creates a fresh, short-lived download link.</p><a href="${escapeHtml(downloadAccessUrl)}" style="display:inline-block;padding:13px 18px;border-radius:8px;background:${brand.ink};color:${brand.cyan};font-size:14px;font-weight:800;text-decoration:none;">Download Automnia <span aria-hidden="true">→</span></a></td></tr></table>`
    : '';
  const instructions = onboardingInstructions(record)
    .map((instruction, index) => `<tr><td valign="top" style="padding:0 12px 14px 0;"><div style="width:26px;height:26px;border-radius:50%;background:${brand.ink};color:${brand.cyan};font-size:12px;font-weight:800;line-height:26px;text-align:center;">${index + 1}</div></td><td valign="top" style="padding:2px 0 14px;color:${brand.lightMuted};font-size:14px;line-height:1.55;">${escapeHtml(String(instruction).replace(/^\d+\.\s*/, ''))}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Your Automnia access is ready</title></head>
  <body style="margin:0;padding:0;background:${brand.ink};color:${brand.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brand.ink};">
      <tr><td align="center" style="padding:34px 12px 42px;background:${brand.ink};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border:1px solid #1D3950;border-radius:18px;overflow:hidden;background:${brand.lightPanel};">
          <tr><td align="center" style="padding:34px 30px 30px;background:${brand.canvas};border-bottom:1px solid #1D3950;">
            <a href="${automniaAppUrl}" style="display:inline-block;text-decoration:none;"><img src="${automniaLogoUrl}" width="300" alt="Automnia AI Nexus" style="display:block;width:300px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"></a>
            <div style="margin-top:18px;color:${brand.muted};font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;">Your intelligent command center</div>
          </td></tr>
          <tr><td style="padding:14px 24px;text-align:center;background:${brand.cyan};color:${brand.ink};font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">Access provisioned · Ready to activate</td></tr>
          <tr><td style="padding:38px 34px 30px;background:${brand.lightCanvas};">
            <h1 style="margin:0 0 12px;color:${brand.lightText};font-size:28px;line-height:1.2;letter-spacing:-.02em;">${greeting}</h1>
            <p style="margin:0 0 26px;color:${brand.lightMuted};font-size:15px;line-height:1.7;">Thank you for choosing Automnia AI Nexus. Your purchase has been provisioned and your account is ready to link.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #A9D4F2;border-radius:15px;background:${brand.lightPanel};">
              <tr><td style="padding:24px 24px 22px;border-left:4px solid ${brand.cyan};">
                <div style="margin:0 0 16px;color:${brand.blue};font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;">Your secure access details</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="padding:0 0 10px;color:${brand.lightMuted};font-size:13px;line-height:1.5;"><strong style="color:${brand.lightText};">Purchase email</strong><br>${email}</td></tr>
                  <tr><td style="padding:0;color:${brand.lightMuted};font-size:13px;line-height:1.5;"><strong style="color:${brand.lightText};">Plan</strong><br>${tier}</td></tr>
                  <tr><td style="padding:18px 0 0;"><div style="padding:16px 17px;border:1px solid #2B5D78;border-radius:10px;background:${brand.ink};color:${brand.cyan};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;font-weight:900;letter-spacing:.08em;line-height:1.45;word-break:break-word;">${licenseKey}</div></td></tr>
                  <tr><td style="padding:12px 0 0;color:${brand.lightMuted};font-size:13px;line-height:1.6;">${access}</td></tr>
                </table>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;"><tr><td style="padding:0 0 7px;color:${brand.blue};font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;">Get started in four steps</td></tr><tr><td style="padding:0 0 12px;color:${brand.lightText};font-size:19px;font-weight:850;line-height:1.3;">Activate your access</td></tr>${instructions}</table>
            ${downloadSection}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-radius:12px;background:#EAF2F9;"><tr><td style="padding:17px 18px;color:${brand.lightMuted};font-size:13px;line-height:1.65;"><strong style="color:${brand.lightText};">Keep this message private.</strong> Automnia support will never ask you to publish your license key. Use the same purchase email whenever you sign in or link an upgrade.</td></tr></table>
            <p style="margin:28px 0 0;color:${brand.lightMuted};font-size:13px;line-height:1.65;">We are glad to have you with us.<br><strong style="color:${brand.lightText};">The Automnia AI Nexus team</strong></p>
          </td></tr>
          <tr><td style="padding:25px 30px;text-align:center;background:${brand.canvas};border-top:1px solid #1D3950;color:${brand.muted};font-size:11px;line-height:1.7;">Automnia AI Nexus<br><a href="mailto:support@automnia.app" style="color:${brand.cyan};text-decoration:none;">support@automnia.app</a> · Secure account activation</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
