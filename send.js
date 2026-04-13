const nodemailer = require('nodemailer');
const fs = require('fs');

const tasks  = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const now  = new Date();

function isDST() {
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  return now.getTimezoneOffset() < Math.max(jan, jul);
}

function toUTC(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const offset = isDST() ? 2 : 1;
  let utcH = h - offset;
  if (utcH < 0) utcH += 24;
  return utcH.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
}

const schedulesUTC = (config.schedules || []).map(toUTC);
const shouldSend   = schedulesUTC.some(s => {
  const [h, m] = s.split(':').map(Number);
  return now.getUTCHours() === h && now.getUTCMinutes() < 15;
});

if (!shouldSend && process.env.FORCE !== 'true') {
  console.log('Pas l\'heure d\'envoyer');
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASSWORD }
});

const priorityOrder = { high: 0, medium: 1, low: 2 };
const pLabel = { high: 'Urgent', medium: 'Moyen', low: 'Faible' };
const pColor = { high: '#A32D2D', medium: '#854F0B', low: '#3B6D11' };
const pBg    = { high: '#FCEBEB', medium: '#FAEEDA', low: '#EAF3DE' };
const APP_URL = process.env.APP_URL || 'https://napolsg.github.io/taskmail/todo-email.html';

const dateStr = now.toLocaleString('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
});

function buildHTML(taskList, recipientLabel) {
  const sorted = [...taskList].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const rows = sorted.map(t => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #F2F2F7;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="background:${pBg[t.priority]};color:${pColor[t.priority]};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;">${pLabel[t.priority]}</span>
          <span style="font-size:14px;color:#1C1C1E;font-weight:500;">${t.title}</span>
          ${t.project ? `<span style="font-size:11px;color:#8E8E93;">-- ${t.project}</span>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F7;padding:32px 16px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
          <tr><td style="background:#185FA5;border-radius:16px 16px 0 0;padding:24px 28px 0;">
            <div style="font-size:22px;font-weight:800;color:#E6F1FB;">TaskMail</div>
            <div style="font-size:13px;color:#85B7EB;margin-top:4px;padding-bottom:20px;">${dateStr}</div>
          </td></tr>
          <tr><td style="background:#185FA5;padding:0 28px 20px;">
            <div style="background:rgba(255,255,255,0.15);border-radius:10px;padding:12px 16px;display:inline-block;">
              <span style="font-size:28px;font-weight:800;color:#E6F1FB;">${taskList.length}</span>
              <span style="font-size:14px;color:#B5D4F4;margin-left:6px;">tache${taskList.length > 1 ? 's' : ''} ${recipientLabel}</span>
            </div>
          </td></tr>
          <tr><td style="background:white;">
            <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          </td></tr>
          <tr><td style="background:white;border-top:1px solid #F2F2F7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:#185FA5;color:#E6F1FB;text-decoration:none;padding:10px 24px;border-radius:20px;font-size:14px;font-weight:700;">Ouvrir TaskMail</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function sendMail(to, subject, html) {
  return new Promise((resolve, reject) => {
    transporter.sendMail({ from: `TaskMail <${process.env.GMAIL_USER}>`, to, subject, html }, (err, info) => {
      if (err) reject(err); else resolve(info);
    });
  });
}

(async () => {
  const pending = tasks.filter(t => !t.done);
  if (!pending.length) { console.log('Aucune tache en attente'); process.exit(0); }

  // Email au propriétaire : tâches sans assigné ou assignées à lui-même
  const ownerTasks = pending.filter(t => !t.assignee || t.assignee === process.env.GMAIL_USER);
  if (ownerTasks.length) {
    await sendMail(
      process.env.GMAIL_USER,
      `TaskMail -- ${ownerTasks.length} tache${ownerTasks.length > 1 ? 's' : ''} a faire`,
      buildHTML(ownerTasks, 'en attente')
    );
    console.log(`Email envoye au proprietaire (${ownerTasks.length} taches)`);
  }

  // Emails aux assignés groupés par adresse
  const byAssignee = {};
  pending
    .filter(t => t.assignee && t.assignee !== process.env.GMAIL_USER)
    .forEach(t => {
      if (!byAssignee[t.assignee]) byAssignee[t.assignee] = [];
      byAssignee[t.assignee].push(t);
    });

  for (const [email, assignedTasks] of Object.entries(byAssignee)) {
    await sendMail(
      email,
      `TaskMail -- ${assignedTasks.length} tache${assignedTasks.length > 1 ? 's' : ''} qui vous sont assignees`,
      buildHTML(assignedTasks, 'assignees')
    );
    console.log(`Email envoye a ${email} (${assignedTasks.length} taches)`);
  }
})();
