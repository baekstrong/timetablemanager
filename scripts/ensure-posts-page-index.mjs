// Add only the index needed by the category board cursor query.
// Never replaces existing indexes or modifies rules/documents.
// Check: node scripts/ensure-posts-page-index.mjs --project traininglogforclients
// Apply: add --apply; the returned operation may still be building.
// Use --gcloud for the already-authenticated deployment operator instead of the
// application service account, which may only have index read permission.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';

const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || project !== 'traininglogforclients') {
    throw new Error('Explicit --project traininglogforclients is required.');
}
let token;
if (args.includes('--gcloud')) {
    token = execFileSync(process.env.GCLOUD_BIN || 'gcloud', ['auth', 'print-access-token'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} else {
    const credentials = JSON.parse(readFileSync(new URL('../firebase-admin-key.json', import.meta.url), 'utf8'));
    if (credentials.project_id !== project) throw new Error('Credential project does not match the requested project.');
    const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/datastore'] });
    const client = await auth.getClient();
    ({ token } = await client.getAccessToken());
}
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/posts/indexes`;
const definition = {
    queryScope: 'COLLECTION',
    fields: [
        { fieldPath: 'category', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
};
async function request(url, body) {
    const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Firestore index request failed: ${response.status} ${result.error?.status || ''}`);
    return result;
}
let pageToken;
let existing;
do {
    const page = await request(base + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''));
    existing = (page.indexes || []).find(index => index.queryScope === definition.queryScope &&
        JSON.stringify(index.fields.filter(field => field.fieldPath !== '__name__')) === JSON.stringify(definition.fields));
    pageToken = page.nextPageToken;
} while (!existing && pageToken);
if (existing) {
    console.log(JSON.stringify({ index: existing.name, state: existing.state, created: false }));
} else if (args.includes('--apply')) {
    const operation = await request(base, definition);
    console.log(JSON.stringify({ operation: operation.name, created: true, done: Boolean(operation.done) }));
} else {
    console.log(JSON.stringify({ missing: true, definition }));
    process.exitCode = 2;
}
