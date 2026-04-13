const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { Octokit } = require('@octokit/rest');

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
    const imap = new Imap({
      user: process.env.GMAIL_USER,
      password: process.env.GMAIL_PASSWORD,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);

        // Cherche uniquement les emails non lus avec sujet "taskmail"
        // ET envoyés par le propriétaire du compte (pas les notifications)
        imap.search([
          'UNSEEN',
          ['SUBJECT', 'taskmail'],
          ['FROM', process.env.GMAIL_USER]
        ], (err, results) => {
          if (err || !results || !results.length) {
            console.log('Aucun nouvel email trouvé');
            imap.end();
            return resolve([]);
          }

          console.log(`${results.length} email(s) trouvé(s)`);
          const f = imap.fetch(results, { bodies: '' });

          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, mail) => {
                if (err) return;

                // Ignore les emails de notification GitHub
                const from = (mail.from?.text || '').toLowerCase();
                if (from.includes('github') || from.includes('noreply')) return;

                const text = mail.text || '';
                // Prend uniquement le corps principal (ignore les parties citées)
                const body = text.split(/^>.*$/m)[0];

                const lines = body.split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 1);

                lines.forEach(line => {
                  let priority = 'medium';
                  let title = line;
                  if (line.startsWith('!')) { priority = 'high'; title = line.slice(1).trim(); }
                  if (line.startsWith('-')) { priority = 'low';  title = line.slice(1).trim(); }
                  if (title && title.length > 1) {
                    newTasks.push({
                      id: Date.now() + Math.random(),
                      title,
                      priority,
                      project: '',
                      done: false,
                      created: new Date().toISOString()
                    });
                  }
                });
              });
            });
          });

          f.once('end', () => {
            // Marque les emails comme lus
            imap.setFlags(results, ['\\Seen'], () => imap.end());
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
    if (!newTasks.length) { console.log('Aucune nouvelle tâche à ajouter'); return; }
    const { tasks, sha } = await getTasks();
    await saveTasks([...newTasks, ...tasks], sha);
    console.log(`✓ ${newTasks.length} tâche(s) ajoutée(s) :`, newTasks.map(t => t.title));
  } catch(e) {
    console.error('Erreur:', e.message);
    process.exit(1);
  }
})();
