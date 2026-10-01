import {test} from 'node:test';
import assert from 'node:assert/strict';

import {codexCandidates, sortNodeVersionsDesc} from '../ai-usage@local/lib/codexPath.js';

test('sortNodeVersionsDesc orders numerically, newest first', () => {
    assert.deepEqual(
        sortNodeVersionsDesc(['v18.20.4', 'v20.9.0', 'v20.11.1', 'v9.0.0']),
        ['v20.11.1', 'v20.9.0', 'v18.20.4', 'v9.0.0']);
});

test('sortNodeVersionsDesc drops entries that are not versions', () => {
    assert.deepEqual(sortNodeVersionsDesc(['default', 'v22.1.0', '.cache']), ['v22.1.0']);
});

test('codexCandidates follows the documented search order', () => {
    assert.deepEqual(codexCandidates('/home/u', ['v18.0.0', 'v22.3.0']), [
        '/home/u/.local/bin/codex',
        '/home/u/.npm-global/bin/codex',
        '/home/u/.nvm/versions/node/v22.3.0/bin/codex',
        '/home/u/.nvm/versions/node/v18.0.0/bin/codex',
        '/usr/local/bin/codex',
    ]);
});

test('codexCandidates works with no nvm installs', () => {
    assert.deepEqual(codexCandidates('/home/u', []), [
        '/home/u/.local/bin/codex',
        '/home/u/.npm-global/bin/codex',
        '/usr/local/bin/codex',
    ]);
});
