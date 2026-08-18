function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
const automniaTealLogo = `
  <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Automnia AI Nexus" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="automnia-teal" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6BE7D4"/>
        <stop offset="1" stop-color="#0D9488"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="16" fill="#0B1118" stroke="#4CC7B8" stroke-width="2"/>
    <path d="M16 45 29.5 15h5L48 45h-7.2l-2.8-7.1H26L23.2 45H16Zm12.4-13.2h7.2L32 22.6l-3.6 9.2Z" fill="url(#automnia-teal)"/>
    <circle cx="32" cy="49" r="2.5" fill="#6BE7D4"/>
  </svg>`;

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
  const instructions = onboardingInstructions(record)
    .map((instruction) => `<li style="margin:0 0 10px 0;color:#475569;line-height:1.55;">${escapeHtml(String(instruction).replace(/^\d+\.\s*/, ''))}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#081016;color:#D5E2F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="width:100%;padding:28px 12px;background:linear-gradient(145deg,#081016 0%,#101B24 55%,#071014 100%);">
      <div style="max-width:640px;margin:0 auto;background:#F8FAFC;border:1px solid #20313D;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,.35);">
        <div style="padding:30px 28px 24px;text-align:center;background:linear-gradient(145deg,#0B1118,#15232D);border-bottom:3px solid #4CC7B8;">
          ${automniaTealLogo}
          <div style="margin-top:12px;color:#FFFFFF;font-size:25px;font-weight:800;letter-spacing:.06em;">AUTMNIA <span style="color:#6BE7D4;">AI NEXUS</span></div>
          <div style="margin-top:7px;color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">Your intelligent command center</div>
        </div>
        <div style="padding:12px 20px;text-align:center;background:linear-gradient(90deg,#0D9488,#10B981,#4CC7B8);color:#061014;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Welcome — your Automnia access is ready</div>
        <div style="padding:34px 30px 30px;">
          <h1 style="margin:0 0 14px;color:#0F172A;font-size:25px;line-height:1.25;">Welcome, ${name}.</h1>
          <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.65;">Thank you for choosing Automnia AI Nexus. Your purchase has been provisioned and your account is ready to link.</p>
          <div style="margin:24px 0;padding:22px;border:1px solid #99E6DA;border-left:5px solid #0D9488;border-radius:12px;background:#ECFEFA;">
            <div style="margin-bottom:13px;color:#0F766E;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Your secure access details</div>
            <div style="margin:10px 0;color:#334155;font-size:14px;"><strong>Purchase email:</strong> ${email}</div>
            <div style="margin:10px 0;color:#334155;font-size:14px;"><strong>Plan:</strong> ${tier}</div>
            <div style="margin-top:16px;padding:13px 15px;border-radius:8px;background:#0B1118;color:#6BE7D4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;font-weight:800;letter-spacing:.08em;word-break:break-word;">${licenseKey}</div>
            <div style="margin-top:12px;color:#475569;font-size:13px;line-height:1.5;">${access}</div>
          </div>
          <h2 style="margin:28px 0 12px;color:#0F172A;font-size:18px;">Get started in four steps</h2>
          <ol style="margin:0;padding-left:24px;">${instructions}</ol>
          <div style="margin-top:26px;padding:17px 18px;border-radius:10px;background:#F1F5F9;color:#475569;font-size:13px;line-height:1.6;">
            <strong style="color:#0F172A;">Keep this message private.</strong> Automnia support will never ask you to publish your license key. Use the same purchase email whenever you sign in or link an upgrade.
          </div>
          <p style="margin:26px 0 0;color:#64748B;font-size:13px;line-height:1.6;">We are glad to have you with us.<br><strong style="color:#0F172A;">The Automnia AI Nexus team</strong></p>
        </div>
        <div style="padding:18px 30px;background:#0B1118;color:#94A3B8;font-size:11px;line-height:1.5;text-align:center;">Automnia AI Nexus · Secure account activation · Please retain this email for your records</div>
      </div>
    </div>
  </body>
</html>`;
}
