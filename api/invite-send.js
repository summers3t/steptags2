import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, link, projectName, inviterName, role, expiresAtISO } = req.body || {};
  if (!email || !link) return res.status(400).json({ error: 'email and link are required' });

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !MAIL_FROM)
    return res.status(500).json({ error: 'SMTP env vars missing' });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const subj = `You're invited to ${projectName || 'a StepTags project'}`;
  const text = [
    `${inviterName || 'A teammate'} invited you${role ? ` as ${role}` : ''}${projectName ? ` to ${projectName}` : ''}.`,
    `Open the link to join: ${link}`,
    expiresAtISO ? `This invite may expire on ${expiresAtISO}.` : '',
    '',
    'If you did not expect this email, you can ignore it.'
  ].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
      <h2>StepTags invitation</h2>
      <p>${inviterName || 'A teammate'} invited you${role ? ` as <b>${role}</b>` : ''}${projectName ? ` to <b>${projectName}</b>` : ''}.</p>
      <p><a href="${link}">Accept invitation</a></p>
      ${expiresAtISO ? `<p>This invite may expire on ${expiresAtISO}.</p>` : ''}
      <p style="color:#666">If you did not expect this email, ignore it.</p>
    </div>
  `;

  const info = await transporter.sendMail({ from: MAIL_FROM, to: email, subject: subj, text, html });
  res.status(200).json({ ok: true, id: info.messageId });
}
