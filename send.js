const nodemailer = require('nodemailer');
const fs = require('fs');

const tasks = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const pending = tasks.filter(t => !t.done);

if (pending.length === 0) {
  console.log('Aucune tâche en attente, email non envoyé.');
  process.exit(0);
}

const pLabel = { high: 'URGENT', medium: 'Moyen', low: 'Faible' };
const lines = pending
  .sort((a,b) => ({ high:0, medium:1, low:2 })[a.priority] - ({ high:0, medium:1, low:2 })[b.priority])
  .map((t,i) => `${i+1}. [${pLabel[t.priority]}] ${t.title}${t.project ? ' — ' + t.project : ''}`)
  .join('\n');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD,
  }
});

const mailOptions = {
  from: process.env.GMAIL_USER,
  to: process.env.GMAIL_USER,
  subject: `TaskMail — ${pending.length} tâche(s) à faire`,
  text: `Bonjour,\n\nVos tâches du ${new Date().toLocaleString('fr-FR')} :\n\n${lines}\n\n— TaskMail`,
};

transporter.sendMail(mailOptions, (err, info) => {
  if (err) { console.error('Erreur :', err); process.exit(1); }
  console.log('Email envoyé :', info.response);
});
