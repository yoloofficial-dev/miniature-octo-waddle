// check-status.js
// Polls api.mcserverhost.com/status, diffs each node's status against the
// last known state (state/last-status.json), and on any online<->offline
// flip: appends a line to history.log and POSTs an alert to Formspree.
//
// Runs on a schedule via GitHub Actions (see .github/workflows/monitor.yml).
// State and history are committed back to the repo by the workflow so the
// diff is preserved between runs.

const fs = require('fs');
const path = require('path');

const STATUS_API = 'https://api.mcserverhost.com/status';
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mkolaaal';
const RECIPIENTS = ['huankimgregoreyonlay@gmail.com', 'redgrockyofficial@gmail.com'];

const STATE_DIR = path.join(__dirname, 'state');
const STATE_FILE = path.join(STATE_DIR, 'last-status.json');
const HISTORY_FILE = path.join(__dirname, 'history.log');

function nowStamp() {
    // e.g. 2026-07-19 14:32:05 UTC
    return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function loadLastState() {
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        // No state file yet (first run) or unreadable — start fresh.
        return {};
    }
}

function saveState(state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function appendHistory(line) {
    fs.appendFileSync(HISTORY_FILE, line + '\n', 'utf8');
}

async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

async function sendAlertEmail(nodeName, oldStatus, newStatus) {
    const subject = `[Status Alert] ${nodeName} is now ${newStatus.toUpperCase()}`;
    const message =
        `Node: ${nodeName}\n` +
        `Previous status: ${oldStatus}\n` +
        `New status: ${newStatus}\n` +
        `Time: ${nowStamp()}`;

    const body = {
        subject,
        message,
        node: nodeName,
        previous_status: oldStatus,
        new_status: newStatus,
        timestamp: nowStamp(),
        // Formspree free plan: notifications go to the email(s) linked on the
        // form itself (up to 2). These fields are included for reference /
        // in case the form is configured to read a recipient list, but the
        // actual delivery addresses are whatever's linked in the Formspree
        // dashboard for this form.
        recipients: RECIPIENTS.join(', ')
    };

    const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Formspree POST failed (${res.status}): ${text}`);
    }
}

async function main() {
    console.log(`[${nowStamp()}] Checking node status...`);

    const res = await fetchWithTimeout(STATUS_API, 10000);
    if (!res.ok) {
        throw new Error(`Status API error: ${res.status}`);
    }
    const data = await res.json();
    const nodes = data.nodes || [];

    if (nodes.length === 0) {
        console.log('No nodes returned by status API. Nothing to do.');
        return;
    }

    const lastState = loadLastState();
    const newState = {};
    const flips = [];

    for (const node of nodes) {
        if (!node.node_name) continue;
        const key = node.node_name;
        const currentStatus = node.status === 'online' ? 'online' : 'offline';
        newState[key] = currentStatus;

        const previousStatus = lastState[key];

        // Only alert on an actual transition. If we've never seen this node
        // before, record its state but don't alert (avoids a false "back
        // online" blast the first time the workflow runs, or after adding a
        // brand-new node).
        if (previousStatus !== undefined && previousStatus !== currentStatus) {
            flips.push({ node: key, from: previousStatus, to: currentStatus });
        }
    }

    if (flips.length === 0) {
        console.log('No status changes detected.');
        saveState(newState);
        return;
    }

    for (const flip of flips) {
        const line = `[${nowStamp()}] ${flip.node}: ${flip.from} -> ${flip.to}`;
        console.log(line);
        appendHistory(line);

        try {
            await sendAlertEmail(flip.node, flip.from, flip.to);
            console.log(`  -> alert email sent for ${flip.node}`);
        } catch (err) {
            console.error(`  -> FAILED to send alert email for ${flip.node}: ${err.message}`);
            appendHistory(`[${nowStamp()}] ${flip.node}: ALERT EMAIL FAILED (${err.message})`);
        }
    }

    saveState(newState);
}

main().catch(err => {
    console.error('Fatal error in check-status.js:', err);
    process.exit(1);
});
