const { Octokit } = require('@octokit/rest');
const fs = require('fs');

const octokit = new Octokit({ auth: process.env.MY_GITHUB_TOKEN });
const owner = 'napolsg';
const repo  = 'taskmail';

const raw      = JSON.parse(fs.readFileSync('tasks.json', 'utf8'));
const tasks    = Array.isArray(raw) ? raw : (raw.tasks || []);
const deletedIds = Array.isArray(raw) ? [] : (raw.deletedIds || []);

// Récupère les contacts depuis config.json pour trouver le dépôt cible
const config   = fs.existsSync('config.json') ? JSON.parse(fs.readFileSync('config.json', 'utf8')) : {};
const contacts = config.contacts || [];

// Groupe les tâches assignées par dépôt cible
const byRepo = {};
tasks.forEach(t => {
  if (!t.assigneeRef || !t.assigneeRef.startsWith('__contact_')) return;
  if (t.done) return;
  if (t.assignedBy) return; // tâche reçue, on ne la repousse pas

  // Trouve le contact via l'index dans assigneeRef (__contact_0__ -> index 0)
  const match = t.assigneeRef.match(/__contact_(\d+)__/);
  if (!match) return;
  const idx = parseInt(match[1]);
  const ct  = contacts[idx];
  if (!ct || !ct.repo) return;

  const targetRepo = ct.repo;
  if (targetRepo === repo) return;
  if (!byRepo[targetRepo]) byRepo[targetRepo] = [];
  byRepo[targetRepo].push(t);
});

async function pushToRepo(targetRepo, newTasks) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo: targetRepo, path: 'tasks.json' });
    const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString());
    const remote = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
    const remoteDeletedIds = Array.isArray(parsed) ? [] : (parsed.deletedIds || []);

    const remoteIds = new Set(remote.map(t => String(t.id)));
    const toAdd = newTasks
      .filter(t => !remoteIds.has(String(t.id)))
      .map(t => ({
        ...t,
        assignedBy: config.ownerName || repo,
        assigneeRef: '',
        assignee: ''
      }));

    if (!toAdd.length) {
      console.log(`Rien de nouveau pour ${targetRepo}`);
      return;
    }

    const merged = [...toAdd, ...remote];
    const payload = { tasks: merged, deletedIds: remoteDeletedIds };
    const content = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');

    await octokit.repos.createOrUpdateFileContents({
      owner, repo: targetRepo, path: 'tasks.json',
      message: `TaskMail: taches assignees depuis ${repo}`,
      content, sha: data.sha
    });

    console.log(`${toAdd.length} tache(s) poussee(s) vers ${targetRepo}: ${toAdd.map(t => t.title).join(', ')}`);
  } catch(e) {
    console.error(`Erreur push vers ${targetRepo}:`, e.message);
  }
}

(async () => {
  if (!Object.keys(byRepo).length) {
    console.log('Aucune tache assignee a pousser');
    return;
  }
  for (const [targetRepo, repoTasks] of Object.entries(byRepo)) {
    await pushToRepo(targetRepo, repoTasks);
  }
})();
