const nodemailer = require('nodemailer');
const fs = require('fs');

const tasks  = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const raw        = Array.isArray(tasks) ? { tasks, deletedIds: [] } : tasks;
const allTasks   = raw.tasks || [];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASSWORD }
});

const pLabel = { high: 'Urgent', medium: 'Moyen', low: 'Faible' };
const pColor = { high: '#A32D2D', medium: '#854F0B', low: '#3B6D11' };
const pBg    = { high: '#FCEBEB', medium: '#FAEEDA', low: '#EAF3DE' };
const APP_URL = process.env.APP_URL || 'https://napolsg.github.io/taskmail/todo-email.html';

const now     = new Date();
const dateStr = now.toLocaleString('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
});

function buildNotifHTML(task, type) {
  const isNew       = type === 'assigned';
  const headerColor = isNew ? '#185FA5' : '#34C759';
  const headerText  = isNew
    ? 'Nouvelle tâche assignée'
    : 'Tâche complétée';
  const bodyText = isNew
    ? 'Une nouvelle tâche vous a été assignée :'
    : 'La tâche suivante a été complétée :';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F7;padding:32px 16px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
          <tr><td style="background:${headerColor};border-radius:16px 16px 0 0;padding:24px 28px;">
            <div style="font-size:18px;font-weight:800;color:white;">${headerText}</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:4px;">${dateStr}</div>
          </td></tr>
          <tr><td style="background:white;padding:20px 28px;">
            <p style="font-size:14px;color:#3C3C43;margin:0 0 16px;">${bodyText}</p>
            <div style="background:#F2F2F7;border-radius:12px;padding:14px 16px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="background:${pBg[task.priority]};color:${pColor[task.priority]};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">${pLabel[task.priority]}</span>
                <span style="font-size:15px;color:#1C1C1E;font-weight:600;">${task.title}</span>
                ${task.project ? `<span style="font-size:12px;color:#8E8E93;">— ${task.project}</span>` : ''}
              </div>
              ${task.assignedBy ? `<p style="font-size:12px;color:#8E8E93;margin:8px 0 0;">Assigné par : ${task.assignedBy}</p>` : ''}
            </div>
          </td></tr>
          <tr><td style="background:white;border-top:1px solid #F2F2F7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:${headerColor};color:white;text-decoration:none;padding:10px 24px;border-radius:20px;font-size:14px;font-weight:700;">Ouvrir TaskMail</a>
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
  const type   = process.env.NOTIF_TYPE || 'assigned'; // 'assigned' ou 'completed'
  const taskId = process.env.TASK_ID;
  const toEmail = process.env.TO_EMAIL;

  if (!taskId || !toEmail) {
    console.log('TASK_ID ou TO_EMAIL manquant');
    process.exit(0);
  }

  const task = allTasks.find(t => String(t.id) === String(taskId));
  if (!task) {
    console.log('Tâche non trouvée:', taskId);
    process.exit(0);
  }

  const subject = type === 'assigned'
    ? `TaskMail — Nouvelle tâche : ${task.title}`
    : `TaskMail — Tâche complétée : ${task.title}`;

  await sendMail(toEmail, subject, buildNotifHTML(task, type));
  console.log(`Notification envoyée à ${toEmail} (${type})`);
})();
