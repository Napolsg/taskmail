const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = 'napolsg';
const repo  = 'taskmail';

async function getTasks() {
  const { data } = await octokit.repos.getContent({ owner, repo, path: 'tasks.json' });
  const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString());
  const tasks = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
  const deletedIds = Array.isArray(parsed) ? [] : (parsed.deletedIds || []);
  return { tasks, sha: data.sha, deletedIds };
}

async function saveTasks(tasks, sha, deletedIds = []) {
  const payload = { tasks, deletedIds };
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path: 'tasks.json',
    message: 'TaskMail: nouvelles taches par email',
    content, sha
  });
}

const isSignatureLine = l => {
  const t = l.trim();
  if (!t) return false;
  if (t === '--' || t === '\u2014') return true;
  if (/^\*[^*]+\*$/.test(t)) return true;
  if (/^tel[\s:]/i.test(t)) return true;
  if (/^mob[\s:]/i.test(t)) return true;
  if (/^fax[\s:]/i.test(t)) return true;
  if (/\+?[\d\s.\-()]{8,}$/.test(t) && t.length < 25) return true;
  if (/linkedin\.com/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^<https?:\/\//i.test(t)) return true;
  if (t.startsWith('>')) return true;
  return false;
};

function stripSignature(text) {
  const lines = text.split('\n');
  const cutIdx = lines.findIndex(l => isSignatureLine(l));
  return cutIdx !== -1 ? lines.slice(0, cutIdx).join('\n') : text;
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
        imap.search(['UNSEEN', ['FROM', process.env.GMAIL_USER]], (err, results) => {
          if (err || !results || !results.length) {
            console.log('Aucun nouvel email trouve');
            imap.end();
            return resolve([]);
          }

          console.log(`${results.length} email(s) trouve(s)`);
          const f = imap.fetch(results, { bodies: '' });

          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, mail) => {
                if (err) return;
                const from = (mail.from?.text || '').toLowerCase();
                if (from.includes('github') || from.includes('noreply')) return;
                const subject = (mail.subject || '').trim();
                if (subject.length > 0) return;

                const text = mail.text || '';
                const body = stripSignature(text);

                const lines = body.split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 1 && !isSignatureLine(l));

                lines.forEach(line => {
                  let priority = 'medium';
                  let title = line;
                  if (line.startsWith('!')) { priority = 'high'; title = line.slice(1).trim(); }
                  if (line.startsWith('-')) { priority = 'low';  title = line.slice(1).trim(); }
                  if (title && title.length > 1) {
                    newTasks.push({
                      id: Date.now() + Math.random(),
                      title, priority,
                      project: '', done: false,
                      created: new Date().toISOString()
                    });
                  }
                });
              });
            });
          });

          f.once('end', () => {
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
    if (!newTasks.length) { console.log('Aucune nouvelle tache'); return; }
    const { tasks, sha, deletedIds } = await getTasks();
    await saveTasks([...newTasks, ...tasks], sha, deletedIds);
    console.log(`OK ${newTasks.length} tache(s) ajoutee(s):`, newTasks.map(t => t.title));
  } catch(e) {
    console.error('Erreur:', e.message);
    process.exit(1);
  }
})();
