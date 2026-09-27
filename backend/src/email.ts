type InvitationRole = 'administrator' | 'nurse' | 'doctor' | 'dispatcher';

type InvitationEmail = {
  recipient: string;
  role: InvitationRole;
  hospitalName: string;
  claimUrl: string;
};

const roleContent: Record<InvitationRole, { label: string; description: (hospitalName: string) => string }> = {
  administrator: {
    label: 'administrator',
    description: (hospitalName) => `You now help run ${hospitalName} on NovaCare. Once your access is active, you can manage your hospital and invite nurses and doctors.`,
  },
  nurse: {
    label: 'staff member',
    description: (hospitalName) => `You now have a NovaCare staff account at ${hospitalName}. Once your access is active, you can review patient intake, confirm triage decisions, and manage care queues.`,
  },
  doctor: {
    label: 'doctor',
    description: (hospitalName) => `You now have a NovaCare doctor account at ${hospitalName}. Once your access is active, you can view your department queue, complete consultations, and refer patients.`,
  },
  dispatcher: {
    label: 'dispatcher',
    description: (hospitalName) => `You now coordinate simulated service requests for ${hospitalName} on NovaCare. Once your access is active, you can review the dispatcher queue and manage the demo workflow.`,
  },
};

export function buildInvitationUrl(token: string, baseUrl: string): string {
  return new URL(`/invitations/claim?token=${encodeURIComponent(token)}`, baseUrl).toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function invitationHtml(invitation: InvitationEmail): string {
  const content = roleContent[invitation.role];
  const hospital = escapeHtml(invitation.hospitalName);
  const recipient = escapeHtml(invitation.recipient);
  const claimUrl = escapeHtml(invitation.claimUrl);
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#eef6ff;font-family:Inter,Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6ff;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="background:#0f72dc;border-radius:24px 24px 0 0;padding:26px 32px;">
                <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">Nova<span style="color:#8fd4ff;">Care</span></span>
                <span style="display:block;font-size:11px;color:#cfe8ff;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Care, coordinated</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #dfeaf5;border-top:0;border-radius:0 0 24px 24px;padding:34px 32px;">
                <h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;color:#12356c;letter-spacing:-.5px;">You have been added as a ${content.label} for ${hospital}</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4a5f7d;">${content.description(hospital)} Activate your access with the button below. You will sign in or create your NovaCare account &mdash; please use <strong>${recipient}</strong> so we can match your invitation.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="border-radius:16px;background:#1a8cef;">
                      <a href="${claimUrl}" style="display:inline-block;padding:15px 30px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:16px;">Activate your access</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#6b7f9e;">Or open this link directly:<br><a href="${claimUrl}" style="color:#0f72dc;word-break:break-all;">${claimUrl}</a></p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7f9e;border-top:1px solid #edf2f7;padding-top:16px;">This invitation expires in 72 hours. If you were not expecting it, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;text-align:center;font-size:12px;color:#6b7f9e;">NovaCare &mdash; coordinated care for South African public hospitals</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendInvitationEmail(invitation: InvitationEmail): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.EMAIL_FROM;
  if (!apiKey || !sender) throw new Error('Brevo email is not configured');

  const roleLabel = roleContent[invitation.role].label;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'NovaCare', email: sender.match(/<([^>]+)>/)?.[1] ?? sender },
      to: [{ email: invitation.recipient }],
      subject: `NovaCare invitation: ${roleLabel} at ${invitation.hospitalName}`,
      textContent: `You have been invited to join ${invitation.hospitalName} as a NovaCare ${roleLabel}. Sign in or create your account with ${invitation.recipient} and claim your invitation within 72 hours: ${invitation.claimUrl}`,
      htmlContent: invitationHtml(invitation),
    }),
  });

  if (!response.ok) throw new Error(`Brevo invitation email failed (${response.status})`);
}
