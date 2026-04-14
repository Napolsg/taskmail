const nodemailer = require('nodemailer');
const fs = require('fs');

const raw      = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const allTasks = Array.isArray(raw) ? raw : (raw.tasks || []);
const config   = fs.existsSync('config.json') ? JSON.parse(fs.readFileSync('config.json', 'utf8')) : {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASSWORD }
});

const pLabel = { high: 'Urgent', medium: 'Moyen', low: 'Faible' };
const pColor = { high: '#A32D2D', medium: '#854F0B', low: '#3B6D11' };
const pBg    = { high: '#FCEBEB', medium: '#FAEEDA', low: '#EAF3DE' };

const now     = new Date();
const dateStr = now.toLocaleString('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
});

const APP_URL = process.env.APP_URL || 'https://napolsg.github.io/taskmail/todo-email.html';

function buildHTML(task, type) {
  const headerText = type === 'assigned' ? 'Nouvelle tâche assignée' : 'Tâche complétée';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F7;padding:32px 16px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
          <tr><td style="background:linear-gradient(135deg,#FF6B6B,#FFD93D,#6BCB77);border-radius:16px 16px 0 0;padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;">
                <div style="font-size:20px;font-weight:800;color:white;text-transform:uppercase;letter-spacing:1px;">La To Do du Bonheur</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">${dateStr}</div>
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <div style="background:rgba(255,255,255,0.25);border-radius:10px;padding:10px 16px;display:inline-block;text-align:center;">
                  <div style="font-size:14px;font-weight:800;color:white;">${headerText}</div>
                </div>
              </td>
            </tr></table>
          </td></tr>
          <tr><td style="background:white;padding:20px 28px;">
            <div style="background:#F2F2F7;border-radius:12px;padding:14px 16px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="background:${pBg[task.priority]};color:${pColor[task.priority]};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">${pLabel[task.priority]}</span>
                <span style="font-size:15px;color:#1C1C1E;font-weight:600;">${task.title}</span>
                ${task.project ? `<span style="font-size:12px;color:#8E8E93;">— ${task.project}</span>` : ''}
              </div>
              ${task.assignedBy ? `<p style="font-size:12px;color:#8E8E93;margin:8px 0 0;">${type === 'assigned' ? 'Assigné par' : 'Complété par'} : ${task.assignedBy}</p>` : ''}
            </div>
          </td></tr>
          <tr><td style="background:white;border-top:1px solid #F2F2F7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#FF6B6B,#FFD93D);color:white;text-decoration:none;padding:10px 24px;border-radius:20px;font-size:14px;font-weight:700;">Ouvrir TaskMail</a>
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
  const eventName = process.env.GITHUB_EVENT || 'workflow_dispatch';

  if (eventName === 'push') {
    // Déclenché par un push sur tasks.json
    // Cherche les tâches nouvellement assignées (créées dans les 2 dernières minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const newAssigned = allTasks.filter(t =>
      t.assignedBy &&
      !t.done &&
      t.created &&
      new Date(t.created) > twoMinutesAgo
    );

    if (!newAssigned.length) {
      console.log('Aucune nouvelle tâche assignée récente');
      return;
    }

    for (const task of newAssigned) {
      const toEmail = process.env.GMAIL_USER;
      if (!toEmail) continue;
      await sendMail(
        toEmail,
        `To Do du Bonheur — Nouvelle tâche : ${task.title}`,
        buildHTML(task, 'assigned')
      );
      console.log(`Notification push envoyée pour : ${task.title}`);
    }
  } else {
    // Déclenché manuellement (workflow_dispatch)
    const taskId  = process.env.TASK_ID;
    const toEmail = process.env.TO_EMAIL;
    const type    = process.env.NOTIF_TYPE || 'assigned';

    if (!taskId || !toEmail) { console.log('TASK_ID ou TO_EMAIL manquant'); return; }

    const task = allTasks.find(t => String(t.id) === String(taskId));
    if (!task) { console.log('Tâche non trouvée:', taskId); return; }

    const subject = type === 'assigned'
      ? `To Do du Bonheur — Nouvelle tâche : ${task.title}`
      : `To Do du Bonheur — Tâche complétée : ${task.title}`;

    await sendMail(toEmail, subject, buildHTML(task, type));
    console.log(`Notification ${type} envoyée à ${toEmail}`);
  }
})();
