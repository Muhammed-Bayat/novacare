type InvitationEmail = {
  recipient: string;
  role: 'administrator' | 'nurse' | 'doctor';
  hospitalName: string;
  token: string;
};

function invitationUrl(token: string): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error('APP_BASE_URL is not configured');
  return new URL(`/invitations/claim?token=${encodeURIComponent(token)}`, baseUrl).toString();
}

export async function sendInvitationEmail(invitation: InvitationEmail): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.EMAIL_FROM;
  if (!apiKey || !sender) throw new Error('Brevo email is not configured');

  const roleLabel = invitation.role === 'nurse' ? 'staff member' : invitation.role;
  const claimUrl = invitationUrl(invitation.token);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'NovaCare', email: sender.match(/<([^>]+)>/)?.[1] ?? sender },
      to: [{ email: invitation.recipient }],
      subject: `NovaCare invitation: ${roleLabel} at ${invitation.hospitalName}`,
      textContent: `You have been invited to join ${invitation.hospitalName} as a NovaCare ${roleLabel}. Claim your invitation within 72 hours: ${claimUrl}`,
    }),
  });

  if (!response.ok) throw new Error(`Brevo invitation email failed (${response.status})`);
}
