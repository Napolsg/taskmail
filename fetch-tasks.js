const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');

const imap = new Imap({
  user: process.env.GMAIL_USER,
  password: process.env.GMAIL_PASSWORD,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
});

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = 'napolsg';
const repo  = 'taskmail';

async function getTasks() {
  const { data } = await octokit.repos.getContent({ owner, repo, path: 'tasks.json' });
  return { tasks: JSON.parse(Buffer.from(data.content, 'base64').toString()), sha: data.sha };
}

async function saveTasks(tasks, sha) {
  const content = Buffer.from(JSON.stringify(tasks, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path: 'tasks.json',
    message: 'TaskMail: nouvelles tâches par email',
    content, sha
  });
}

function readEmails() {
  return new Promise((resolve, reject) => {
    const newTasks = [];
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);
        // Cherche les emails non lus avec le sujet "taskmail"
        imap.search(['UNSEEN', ['SUBJECT', 'taskmail']], (err, results) => {
          if (err || !results.length) { imap.end(); return resolve([]); }
          const f = imap.fetch(results, { bodies: '' });
          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, mail) => {
                if (err) return;
                const lines = (mail.text || '').split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 0 && !l.startsWith('>'));
                lines.forEach(line => {
                  let priority = 'medium';
                  let title = line;
                  if (line.startsWith('!')) { priority = 'high';   title = line.slice(1).trim(); }
                  if (line.startsWith('-')) { priority = 'low';    title = line.slice(1).trim(); }
                  if (title) newTasks.push({
                    id: Date.now() + Math.random(),
                    title, priority,
                    project: '',
                    done: false,
                    created: new Date().toISOString()
                  });
                });
              });
            });
          });
          // Marque les emails comme lus
          f.once('end', () => {
            imap.setFlags(results, ['\\Seen'], () => {
              imap.end();
            });
          });
        });
      });
    });
    imap.once('end', () => resolve(newTasks));
    imap.once('error', reject);
    imap.connect();
  });
}

(async () => {
  try {
    const newTasks = await readEmails();
    if (!newTasks.length) { console.log('Aucune nouvelle tâche'); return; }
    const { tasks, sha } = await getTasks();
    await saveTasks([...newTasks, ...tasks], sha);
    console.log(`${newTasks.length} tâche(s) ajoutée(s)`);
  } catch(e) {
    console.error('Erreur:', e); process.exit(1);
  }
})();
