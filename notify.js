const nodemailer = require('nodemailer');
const fs = require('fs');

const raw      = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const allTasks = Array.isArray(raw) ? raw : (raw.tasks || []);
const config   = fs.existsSync('config.json') ? JSON.parse(fs.readFileSync('config.json', 'utf8')) : {};
const contacts = config.contacts || [];

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
  const isAssigned  = type === 'assigned';
  const headerText  = isAssigned ? 'Nouvelle tâche assignée' : 'Tâche complétée !';
  const headerGrad  = isAssigned
    ? 'linear-gradient(135deg,#FF6B6B,#FF8E53)'   // rouge pour assignation
    : 'linear-gradient(135deg,#6BCB77,#38ef7d)';   // vert pour complétion
  const btnGrad     = isAssigned
    ? 'linear-gradient(135deg,#FF6B6B,#FF8E53)'
    : 'linear-gradient(135deg,#6BCB77,#38ef7d)';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
  :root { color-scheme: light; }
  body { background-color: #F2F2F7 !important; color: #1C1C1E !important; }
  td { color: #1C1C1E !important; }
  span { color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { background-color: #F2F2F7 !important; color: #1C1C1E !important; }
    td { background-color: inherit !important; color: #1C1C1E !important; }
    .content-cell { background-color: #FFFFFF !important; color: #1C1C1E !important; }
    .bg-gray { background-color: #F2F2F7 !important; }
  }
</style></head>
  <body style="margin:0;padding:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" bgcolor="#F2F2F7">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F7;padding:32px 16px;">
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
          <tr><td style="background:${headerGrad};border-radius:16px 16px 0 0;padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;">
                <div style="font-size:20px;font-weight:800;color:white;text-transform:uppercase;letter-spacing:1px;">La To Do du Bonheur</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">${dateStr}</div>
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <div style="background:rgba(255,255,255,0.25);border-radius:10px;padding:10px 16px;display:inline-block;">
                  <div style="font-size:14px;font-weight:800;color:white;">${headerText}</div>
                </div>
              </td>
            </tr></table>
          </td></tr>
          <tr><td class="content-cell" style="background:#FFFFFF;color:#1C1C1E;padding:20px 28px;">
            <div class="bg-gray" style="background:#F2F2F7;border-radius:12px;padding:14px 16px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="background:${pBg[task.priority]};color:${pColor[task.priority]};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">${pLabel[task.priority]}</span>
                <span style="font-size:15px;color:#1C1C1E !important;font-weight:600;">${task.title}</span>
                ${task.project ? `<span style="font-size:12px;color:#8E8E93;">— ${task.project}</span>` : ''}
              </div>
              ${task.assignedBy ? `<p style="font-size:12px;color:#8E8E93;margin:8px 0 0;">${isAssigned ? 'Assigné par' : 'Complété par'} : ${task.assignedBy}</p>` : ''}
            </div>
          </td></tr>
          <tr><td class="content-cell" style="background:#FFFFFF;color:#1C1C1E;border-top:1px solid #F2F2F7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:${btnGrad};color:white;text-decoration:none;padding:10px 24px;border-radius:20px;font-size:14px;font-weight:700;">Ouvrir TaskMail</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function sendMail(to, subject, html) {
  return new Promise((resolve, reject) => {
    transporter.sendMail({ from: `ToDoduBonheur <${process.env.GMAIL_USER}>`, to, subject, html }, (err, info) => {
      if (err) reject(err); else resolve(info);
    });
  });
}

(async () => {
  const eventName = process.env.GITHUB_EVENT || 'workflow_dispatch';

  if (eventName === 'push') {
    // Tâches assignées récemment (dernières 2 min)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    // Tâches créées localement ET assignées à quelqu'un d'autre (pas les tâches reçues)
    const newAssigned = allTasks.filter(t =>
      !t.assignedBy &&           // pas une tâche reçue
      t.assigneeRef &&           // assignée à quelqu'un
      !t.done &&
      t.created &&
      new Date(t.created) > twoMinAgo
    );

    if (!newAssigned.length) {
      console.log('Aucune nouvelle tâche assignée récente');
      return;
    }

    for (const task of newAssigned) {
      // Trouve l'email du destinataire via contacts
      let toEmail = null;
      if (task.assigneeRef) {
        const match = task.assigneeRef.match(/__contact_(\d+)__/);
        if (match) {
          const ct = contacts[parseInt(match[1])];
          if (ct && ct.email) toEmail = ct.email;
        }
      }
      if (!toEmail) {
        console.log(`Pas d'email pour la tâche : ${task.title}`);
        continue;
      }
      await sendMail(
        toEmail,
        `To Do du Bonheur — Nouvelle tâche : ${task.title}`,
        buildHTML(task, 'assigned')
      );
      console.log(`Notification assignation envoyée à ${toEmail} pour : ${task.title}`);
    }

  } else {
    // workflow_dispatch — complétion ou assignation manuelle
    const taskId  = process.env.TASK_ID;
    const toEmail = process.env.TO_EMAIL;
    const type    = process.env.NOTIF_TYPE || 'assigned';

    if (!taskId || !toEmail) { console.log('TASK_ID ou TO_EMAIL manquant'); return; }

    const task = allTasks.find(t => String(t.id) === String(taskId));
    if (!task) { console.log('Tache non trouvee:', taskId); return; }

    const subject = type === 'assigned'
      ? `To Do du Bonheur — Nouvelle tâche : ${task.title}`
      : `To Do du Bonheur — Tâche complétée : ${task.title}`;

    await sendMail(toEmail, subject, buildHTML(task, type));
    console.log(`Notification ${type} envoyée à ${toEmail}`);
  }
})();
