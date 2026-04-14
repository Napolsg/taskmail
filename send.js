const nodemailer = require('nodemailer');
const fs = require('fs');

const raw    = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const tasks  = Array.isArray(raw) ? raw : (raw.tasks || []);
const deletedIds = new Set(Array.isArray(raw) ? [] : (raw.deletedIds || []));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const now  = new Date();

function isFranceDST(date) {
  // Heure d'été en France : dernier dimanche de mars au dernier dimanche d'octobre
  const year = date.getUTCFullYear();
  // Dernier dimanche de mars
  const lastSundayMarch = new Date(Date.UTC(year, 2, 31));
  lastSundayMarch.setUTCDate(31 - lastSundayMarch.getUTCDay());
  // Dernier dimanche d'octobre
  const lastSundayOct = new Date(Date.UTC(year, 9, 31));
  lastSundayOct.setUTCDate(31 - lastSundayOct.getUTCDay());
  return date >= lastSundayMarch && date < lastSundayOct;
}

function toUTC(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const offset = isFranceDST(now) ? 2 : 1;
  let utcH = h - offset;
  if (utcH < 0) utcH += 24;
  return utcH.toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0');
}

const schedulesUTC = (config.schedules || []).map(toUTC);
const shouldSend   = schedulesUTC.some(s => {
  const [h, m] = s.split(':').map(Number);
  return now.getUTCHours() === h && now.getUTCMinutes() < 59;
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
          ${t.assignedBy ? `<span style="font-size:11px;color:#185FA5;">Assigné par : ${t.assignedBy}</span>` : ''}
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
  const pending = tasks.filter(t => !t.done && !deletedIds.has(String(t.id)));
  if (!pending.length) { console.log('Aucune tache en attente'); process.exit(0); }

  // Toutes les tâches vont au propriétaire (y compris celles assignées par quelqu'un d'autre)
  const ownerTasks = pending.filter(t =>
    !t.assignee ||                              // pas d'assigné email
    t.assignee === process.env.GMAIL_USER ||    // assigné à soi-même
    t.assignedBy                                // reçue d'un autre dépôt
  );

  if (ownerTasks.length) {
    await sendMail(
      process.env.GMAIL_USER,
      `TaskMail -- ${ownerTasks.length} tache${ownerTasks.length > 1 ? 's' : ''} a faire`,
      buildHTML(ownerTasks, 'en attente')
    );
    console.log(`Email envoye au proprietaire (${ownerTasks.length} taches)`);
  // Enregistre le verrou
  if (lockKey) {
    const today = now.toISOString().split('T')[0];
    const lockData = fs_lock.existsSync(lockFile) ? JSON.parse(fs_lock.readFileSync(lockFile)) : {};
    if (!lockData[today]) lockData[today] = [];
    if (!lockData[today].includes(lockKey)) lockData[today].push(lockKey);
    // Garde seulement les 2 derniers jours
    Object.keys(lockData).filter(d => d < today).forEach(d => delete lockData[d]);
    fs_lock.writeFileSync(lockFile, JSON.stringify(lockData));
  }
  }

  // Emails aux assignés avec email uniquement (pas ceux avec dépôt GitHub)
  const byAssignee = {};
  pending
    .filter(t => t.assignee && t.assignee !== process.env.GMAIL_USER && !t.assignedBy)
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