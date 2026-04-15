const nodemailer = require('nodemailer');
const fs = require('fs');

const raw    = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const tasks  = Array.isArray(raw) ? raw : (raw.tasks || []);
const deletedIds = new Set(Array.isArray(raw) ? [] : (raw.deletedIds || []));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const now  = new Date();

function isFranceDST(date) {
  const year = date.getUTCFullYear();
  const lastSundayMarch = new Date(Date.UTC(year, 2, 31));
  lastSundayMarch.setUTCDate(31 - lastSundayMarch.getUTCDay());
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
const today = now.toISOString().split('T')[0];
const sentToday = config.sentToday || {};

// Trouve l'horaire dépassé le plus récent (sans limite de temps)
const lockKey = schedulesUTC.find(s => {
  const [h, m] = s.split(':').map(Number);
  const scheduleMinutes = h * 60 + m;
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMinutes >= scheduleMinutes;
}) || null;

if (!lockKey && process.env.FORCE !== 'true') {
  console.log("Pas encore l'heure d'envoyer");
  process.exit(0);
}

// Verrou persistant dans config.json
if (lockKey && process.env.FORCE !== 'true') {
  if (sentToday[today] && sentToday[today].includes(lockKey)) {
    console.log('Email deja envoye pour ' + lockKey + ' aujourd\'hui');
    process.exit(0);
  }
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
          <span style="font-size:14px;color:#1C1C1E !important;font-weight:500;">${t.title}</span>
          ${t.project ? `<span style="font-size:11px;color:#8E8E93;">-- ${t.project}</span>` : ''}
          ${t.assignedBy ? `<span style="font-size:11px;color:#185FA5;">Assigne par : ${t.assignedBy}</span>` : ''}
        </div>
      </td>
    </tr>`).join('');

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
          <tr><td style="background:linear-gradient(135deg,#FF6B6B,#FFD93D,#6BCB77);border-radius:16px 16px 0 0;padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:middle;">
                <div style="font-size:20px;font-weight:800;color:white;text-transform:uppercase;letter-spacing:1px;">La To Do du Bonheur</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">${dateStr}</div>
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <div style="background:rgba(255,255,255,0.25);border-radius:10px;padding:10px 16px;display:inline-block;text-align:center;">
                  <div style="font-size:28px;font-weight:800;color:white;line-height:1;">${taskList.length}</div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.9);">tache${taskList.length > 1 ? 's' : ''} ${recipientLabel}</div>
                </div>
              </td>
            </tr></table>
          </td></tr>
          <tr><td class="content-cell" style="background:#FFFFFF;color:#1C1C1E;">
            <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          </td></tr>
          <tr><td class="content-cell" style="background:#FFFFFF;color:#1C1C1E;border-top:1px solid #F2F2F7;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#FF6B6B,#FFD93D);color:white;text-decoration:none;padding:10px 24px;border-radius:20px;font-size:14px;font-weight:700;">Ouvrir TaskMail</a>
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
  const pending = tasks.filter(t => !t.done && !deletedIds.has(String(t.id)));
  if (!pending.length) { console.log('Aucune tache en attente'); process.exit(0); }

  // Email au proprietaire : taches sans assigne ou recues d'un autre depot
  const ownerTasks = pending.filter(t =>
    !t.assignee ||
    t.assignee === process.env.GMAIL_USER ||
    t.assignedBy
  );

  if (ownerTasks.length) {
    await sendMail(
      process.env.GMAIL_USER,
      `To Do du Bonheur -- ${ownerTasks.length} tache${ownerTasks.length > 1 ? 's' : ''} a faire`,
      buildHTML(ownerTasks, 'en attente')
    );
    console.log(`Email envoye au proprietaire (${ownerTasks.length} taches)`);
  }

  // Enregistre le verrou dans config.json sur GitHub
  if (lockKey) {
    try {
      const { Octokit } = require('@octokit/rest');
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      const repoName = process.env.REPO_NAME || 'taskmail';
      const { data } = await octokit.repos.getContent({ owner: 'napolsg', repo: repoName, path: 'config.json' });
      const currentConfig = JSON.parse(Buffer.from(data.content, 'base64').toString());
      if (!currentConfig.sentToday) currentConfig.sentToday = {};
      // Garde seulement aujourd'hui
      currentConfig.sentToday = { [today]: currentConfig.sentToday[today] || [] };
      if (!currentConfig.sentToday[today].includes(lockKey)) {
        currentConfig.sentToday[today].push(lockKey);
      }
      const content = Buffer.from(JSON.stringify(currentConfig, null, 2)).toString('base64');
      await octokit.repos.createOrUpdateFileContents({
        owner: 'napolsg', repo: repoName, path: 'config.json',
        message: 'TaskMail: verrou email ' + lockKey,
        content, sha: data.sha
      });
      console.log('Verrou enregistre pour ' + lockKey);
    } catch(e) {
      console.warn('Impossible d\'enregistrer le verrou:', e.message);
    }
  }

  // Emails aux assignes avec email uniquement (verif que c'est bien un email)
  const byAssignee = {};
  pending
    .filter(t => t.assignee && t.assignee !== process.env.GMAIL_USER && !t.assignedBy && t.assignee.includes('@'))
    .forEach(t => {
      if (!byAssignee[t.assignee]) byAssignee[t.assignee] = [];
      byAssignee[t.assignee].push(t);
    });

  for (const [email, assignedTasks] of Object.entries(byAssignee)) {
    await sendMail(
      email,
      `To Do du Bonheur -- ${assignedTasks.length} tache${assignedTasks.length > 1 ? 's' : ''} qui vous sont assignees`,
      buildHTML(assignedTasks, 'assignees')
    );
    console.log(`Email envoye a ${email} (${assignedTasks.length} taches)`);
  }
})();
